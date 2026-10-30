/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import {
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  logger,
  OverwriteStrategy,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { PY_AGENT_GENERATOR_INFO } from '../../py/agent/generator.js';
import { addPyDependencies } from '../../utils/add-dependencies.js';
import {
  addDestructuredImport,
  addPythonDestructuredImport,
  applyGritQL,
  matchGritQL,
} from '../../utils/ast.js';
import {
  declareDependencies,
  ownedElsewhere,
} from '../../utils/declared-dependencies.js';
import { formatFilesInSubtree } from '../../utils/format.js';
import { FS_DEPENDENCIES, FsCommands } from '../../utils/fs.js';
import { installDependencies } from '../../utils/install.js';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics.js';
import { kebabCase } from '../../utils/names.js';
import {
  addComponentGeneratorMetadata,
  type ComponentMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
  updateComponentGeneratorMetadata,
} from '../../utils/nx.js';
import type { ObservabilityLangfuseGeneratorSchema } from './schema';

export const OBSERVABILITY_LANGFUSE_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

export interface LangfuseMetadata {
  readonly mode: 'langfuse' | 'cloudwatch';
  readonly host: string;
  readonly secretArn: string;
  readonly configHash: string;
  readonly packageCommand: string;
}

export const DEPENDENCIES = declareDependencies<LangfuseMetadata>()({
  ts: [...ownedElsewhere(FS_DEPENDENCIES)],
  py: [
    { name: 'langfuse' },
    { name: 'boto3' },
    { name: 'opentelemetry-api' },
    { name: 'opentelemetry-sdk' },
    { name: 'opentelemetry-exporter-otlp-proto-http' },
    { name: 'opentelemetry-sdk-extension-aws' },
    { name: 'opentelemetry-propagator-aws-xray' },
    { name: 'starlette' },
  ],
});

const digest = (text: string): string =>
  createHash('sha256').update(text).digest('hex');

const normalizeHost = (host: string): string => {
  try {
    const url = new URL(host);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error();
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    throw new Error(
      'Langfuse --host must be an HTTPS base URL without credentials, query parameters, or a fragment.',
    );
  }
};

const resolveAgent = (
  components: ComponentMetadata[],
  name?: string,
): ComponentMetadata => {
  const agents = components.filter(
    (component) => component.generator === PY_AGENT_GENERATOR_INFO.id,
  );
  const agent = name
    ? agents.find((component) => component.name === name)
    : agents.length === 1
      ? agents[0]
      : undefined;
  if (!agent) {
    throw new Error(
      `Select one existing Python agent with --agent. Available agents: ${agents.map((component) => component.name).join(', ') || 'none; run py#agent first'}.`,
    );
  }
  if (
    agent.framework !== 'strands' ||
    agent.protocol !== 'http' ||
    agent.infra !== 'agentcore' ||
    agent.iac !== 'cdk' ||
    agent.auth !== 'iam'
  ) {
    throw new Error(
      'Experimental Langfuse support requires a Python Strands HTTP agent with --infra=agentcore, --iac=cdk, and --auth=iam. Other frameworks, protocols, containers, Terraform, MCP servers, and infra=none are not supported.',
    );
  }
  return agent;
};

export const observabilityLangfuseGenerator = async (
  tree: Tree,
  options: ObservabilityLangfuseGeneratorSchema,
): Promise<GeneratorCallback> => {
  const project = readProjectConfigurationUnqualified(tree, options.project);
  const components = (project.metadata?.components ??
    []) as ComponentMetadata[];
  const agent = resolveAgent(components, options.agent);
  const previous = components.find(
    (component) =>
      component.generator === OBSERVABILITY_LANGFUSE_GENERATOR_INFO.id &&
      component.name === agent.name,
  ) as (ComponentMetadata & LangfuseMetadata) | undefined;
  const mode = options.mode ?? 'langfuse';
  if (!['langfuse', 'cloudwatch'].includes(mode)) {
    throw new Error(
      'Supported modes are langfuse and cloudwatch; dual export is not supported.',
    );
  }
  if (mode === 'cloudwatch' && !previous) {
    logger.info(
      'This agent already uses its generated CloudWatch configuration.',
    );
    return () => {};
  }
  const host = normalizeHost(
    options.host ?? previous?.host ?? 'https://cloud.langfuse.com',
  );
  const secretArn = options.secretArn ?? previous?.secretArn;
  if (
    !secretArn ||
    !/^arn:(aws|aws-us-gov|aws-cn):secretsmanager:[a-z0-9-]+:\d{12}:secret:[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$/.test(
      secretArn,
    )
  ) {
    throw new Error(
      'Provide --secretArn with the complete ARN of an existing Secrets Manager secret. Do not provide Langfuse key values.',
    );
  }
  const unchanged =
    previous?.mode === mode &&
    previous.host === host &&
    previous.secretArn === secretArn;

  const agentDir = joinPathFragments(project.root, agent.path);
  const agentModule = agent.path.split('/').join('.');
  const agentFolder = agent.path.split('/').pop();
  const constructDir = joinPathFragments(
    'packages/common/constructs/src/app/agents',
    kebabCase(agent.rc),
  );
  const construct = joinPathFragments(
    constructDir,
    `${kebabCase(agent.rc)}.ts`,
  );
  const config = joinPathFragments(constructDir, 'langfuse-observability.ts');
  const init = joinPathFragments(agentDir, 'init.py');
  const packageDir = joinPathFragments(project.root, 'package', agentFolder);
  const runtimeFiles = [
    joinPathFragments(agentDir, 'langfuse_telemetry.py'),
    joinPathFragments(packageDir, 'langfuse_main.py'),
    joinPathFragments(project.root, 'tests', `test_${agentFolder}_langfuse.py`),
  ];
  const preservedFiles = runtimeFiles.filter((file) => tree.exists(file));
  const packageTarget = project.targets?.[`${agent.name}-package`];
  const output = packageTarget?.outputs?.[0]?.replace('{workspaceRoot}/', '');
  if (!output || !Array.isArray(packageTarget?.options?.commands)) {
    throw new Error(
      'The generated agent package target was not recognized. Restore it before enabling Langfuse.',
    );
  }
  if (previous) {
    if (
      !tree.exists(config) ||
      (!unchanged && digest(tree.read(config, 'utf-8')) !== previous.configHash)
    ) {
      throw new Error(
        `The generated configuration ${config} was customized or removed. Reconcile it before changing observability options.`,
      );
    }
    if (
      !(await matchGritQL(
        tree,
        construct,
        '`entrypoint: langfuseObservability.entrypoint`',
      )) ||
      !(await matchGritQL(
        tree,
        construct,
        '`configureLangfuseRuntime(this.agentCoreRuntime)`',
      )) ||
      !(await matchGritQL(
        tree,
        construct,
        '`environmentVariables: { $values }` where { $values <: within `this.agentCoreRuntime = new Runtime($args)`, $values <: contains `...langfuseObservability.environmentVariables` }',
      )) ||
      !(await matchGritQL(
        tree,
        init,
        'language python\n`app = FastAPI($args)` where { $args <: contains `**langfuse_fastapi_options()` }',
      ))
    ) {
      throw new Error(
        'The Langfuse runtime wiring was customized or removed. Reconcile the CDK construct and FastAPI initialization before re-running this generator.',
      );
    }
    if (
      unchanged &&
      runtimeFiles.every((file) => tree.exists(file)) &&
      packageTarget.options.commands.includes(previous.packageCommand)
    ) {
      return () => {};
    }
  } else {
    for (const file of [
      config,
      joinPathFragments(agentDir, 'langfuse_telemetry.py'),
      joinPathFragments(packageDir, 'langfuse_main.py'),
    ]) {
      if (tree.exists(file)) {
        throw new Error(
          `Refusing to overwrite existing file ${file}. Rename or reconcile it first.`,
        );
      }
    }
    if (
      !(await matchGritQL(
        tree,
        construct,
        "`entrypoint: $value` where { $value <: `['agentcore_launcher.py']`, $value <: within `this.code = AgentRuntimeArtifact.fromCodeAsset($args)` }",
      )) ||
      !(await matchGritQL(
        tree,
        construct,
        '`this.agentCoreRuntime = new Runtime($args)`',
      )) ||
      !(await matchGritQL(
        tree,
        construct,
        '`environmentVariables: { $values }` where { $values <: within `this.agentCoreRuntime = new Runtime($args)` }',
      )) ||
      !(await matchGritQL(
        tree,
        init,
        'language python\n`app = FastAPI($args)`',
      )) ||
      (await matchGritQL(
        tree,
        init,
        'language python\n`FastAPI($args)` where { $args <: contains `telemetry=$_` }',
      ))
    ) {
      throw new Error(
        'The agent entrypoint, CDK runtime, or FastAPI configuration was customized and cannot be wired safely. Restore the generated wiring before enabling Langfuse.',
      );
    }
  }

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'runtime'),
    agentDir,
    {},
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'package'),
    packageDir,
    { agentModule },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'tests'),
    joinPathFragments(project.root, 'tests'),
    { agentModule, agentFolder },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );
  if (!unchanged) {
    generateFiles(
      tree,
      joinPathFragments(import.meta.dirname, 'files', 'cdk'),
      constructDir,
      {
        mode,
        host: JSON.stringify(host),
        secretArn: JSON.stringify(secretArn),
      },
    );
  }
  if (!previous) {
    await addDestructuredImport(
      tree,
      construct,
      ['langfuseObservability', 'configureLangfuseRuntime'],
      './langfuse-observability.js',
    );
    await applyGritQL(
      tree,
      construct,
      "`entrypoint: $value` where { $value <: `['agentcore_launcher.py']`, $value <: within `this.code = AgentRuntimeArtifact.fromCodeAsset($args)`, $value => `langfuseObservability.entrypoint` }",
    );
    await applyGritQL(
      tree,
      construct,
      '`environmentVariables: { $values }` where { $values <: within `this.agentCoreRuntime = new Runtime($args)`, $values <: not contains `...langfuseObservability.environmentVariables`, $values += `...langfuseObservability.environmentVariables` }',
    );
    await applyGritQL(
      tree,
      construct,
      '`this.agentCoreRuntime = new Runtime($args);` => `this.agentCoreRuntime = new Runtime($args); configureLangfuseRuntime(this.agentCoreRuntime);`',
    );
    await addPythonDestructuredImport(
      tree,
      init,
      ['langfuse_fastapi_options'],
      '.langfuse_telemetry',
    );
    await applyGritQL(
      tree,
      init,
      'language python\nor { `app = FastAPI()` => `app = FastAPI(**langfuse_fastapi_options())`, `app = FastAPI($args)` where { $args <: [$..., $last], $last += `, **langfuse_fastapi_options()` } }',
    );
  }
  const fs = new FsCommands(tree, DEPENDENCIES);
  const copy = fs.cpFile(
    joinPathFragments(packageDir, 'langfuse_main.py'),
    joinPathFragments(output, 'langfuse_main.py'),
  );
  if (!packageTarget.options.commands.includes(copy)) {
    packageTarget.options.commands.push(copy);
    updateProjectConfiguration(tree, project.name, project);
  }
  if (unchanged) {
    await formatFilesInSubtree(tree, undefined, { ignore: preservedFiles });
    return () =>
      installDependencies(tree, options.preferInstallDependencies, {
        languages: ['python'],
      });
  }
  await formatFilesInSubtree(tree, undefined, { ignore: preservedFiles });
  const metadata: LangfuseMetadata = {
    mode,
    host,
    secretArn,
    configHash: digest(tree.read(config, 'utf-8')),
    packageCommand: copy,
  };
  addPyDependencies(tree, DEPENDENCIES, {
    metadata,
    projectRoot: project.root,
  });
  addComponentGeneratorMetadata(
    tree,
    project.name,
    OBSERVABILITY_LANGFUSE_GENERATOR_INFO,
    agent.path,
    agent.name,
    metadata,
  );
  updateComponentGeneratorMetadata(
    tree,
    project.name,
    OBSERVABILITY_LANGFUSE_GENERATOR_INFO,
    agent.name,
    metadata,
  );
  await addGeneratorMetricsIfApplicable(tree, [
    OBSERVABILITY_LANGFUSE_GENERATOR_INFO,
  ]);
  await formatFilesInSubtree(tree, undefined, { ignore: preservedFiles });
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['python'],
    });
};

export default observabilityLangfuseGenerator;
