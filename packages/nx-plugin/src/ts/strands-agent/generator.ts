/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  GeneratorCallback,
  OverwriteStrategy,
  Tree,
  addDependenciesToPackageJson,
  generateFiles,
  installPackagesTask,
  joinPathFragments,
  updateProjectConfiguration,
} from '@nx/devkit';
import { TsStrandsAgentGeneratorSchema } from './schema';
import {
  NxGeneratorInfo,
  addComponentGeneratorMetadata,
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { formatFilesInSubtree } from '../../utils/format';
import { kebabCase, toClassName } from '../../utils/names';
import { TS_VERSIONS, withVersions } from '../../utils/versions';
import { getNpmScope } from '../../utils/npm-scope';
import { addTypeScriptBundleTarget } from '../../utils/bundle/bundle';
import { resolveIacProvider } from '../../utils/iac';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { addAgentInfra } from '../../utils/agent-core-constructs/agent-core-constructs';

import { assignPort } from '../../utils/port';
import { FsCommands } from '../../utils/fs';
import { ensureTypeScriptAgentConnectionProject } from '../../utils/agent-connection/agent-connection';

export const TS_STRANDS_AGENT_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const tsStrandsAgentGenerator = async (
  tree: Tree,
  options: TsStrandsAgentGeneratorSchema,
): Promise<GeneratorCallback> => {
  const project = readProjectConfigurationUnqualified(tree, options.project);

  if (!tree.exists(joinPathFragments(project.root, 'tsconfig.json'))) {
    throw new Error(
      `Unsupported project ${options.project}. Expected a TypeScript project (with a tsconfig.json)`,
    );
  }

  const defaultName = `${kebabCase(project.name.split('/').pop())}-agent`;
  const name = kebabCase(options.name || defaultName);
  const agentNameClassName = toClassName(name);
  const agentTargetPrefix = options.name ? name : 'agent';
  const targetSourceDirRelativeToProjectRoot = joinPathFragments(
    'src',
    agentTargetPrefix,
  );
  const targetSourceDir = joinPathFragments(
    project.root,
    targetSourceDirRelativeToProjectRoot,
  );
  const relativeSourceDir = targetSourceDir.replace(project.root + '/', './');
  const distDir = joinPathFragments('dist', project.root);

  const computeType = options.computeType ?? 'BedrockAgentCoreRuntime';
  const auth = options.auth ?? 'IAM';
  const protocol = options.protocol ?? 'HTTP';

  if (protocol === 'AG-UI') {
    throw new Error(
      `The AG-UI protocol is not yet supported for TypeScript Strands Agents. ` +
        `Use a Python Strands Agent with protocol='AG-UI' instead, or choose 'HTTP' or 'A2A' for TypeScript. ` +
        `Track TypeScript support at https://github.com/strands-agents/sdk-typescript/issues/347`,
    );
  }

  const templateContext = {
    name,
    agentNameClassName,
    distDir,
  };

  // Generate common files shared by both protocols
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'common'),
    targetSourceDir,
    templateContext,
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Generate protocol-specific files
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', protocol.toLowerCase()),
    targetSourceDir,
    templateContext,
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Ensure the shared agent-connection project exists so the CLI script
  // can import `runCliChat` / `getConnectedAgentRuntimeArn` from it.
  await ensureTypeScriptAgentConnectionProject(tree);

  if (computeType === 'BedrockAgentCoreRuntime') {
    const dockerImageTag = `${getNpmScope(tree)}-${name}:latest`;

    // Add bundle target
    await addTypeScriptBundleTarget(tree, project, {
      targetFilePath: `${targetSourceDirRelativeToProjectRoot}/index.ts`,
      bundleOutputDir: joinPathFragments('agent', name),
    });

    // Add the Dockerfile
    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files', 'deploy'),
      targetSourceDir,
      {
        distDir,
        name,
        protocol,
        adotVersion:
          TS_VERSIONS['@aws/aws-distro-opentelemetry-node-autoinstrumentation'],
      },
      { overwriteStrategy: OverwriteStrategy.KeepExisting },
    );

    const dockerOutputDir = joinPathFragments(
      'dist',
      project.root,
      'bundle',
      'agent',
      name,
    );
    const dockerTargetName = `${agentTargetPrefix}-docker`;

    const fs = new FsCommands(tree);
    project.targets[dockerTargetName] = {
      cache: true,
      executor: 'nx:run-commands',
      options: {
        commands: [
          fs.cp(
            `${targetSourceDir}/Dockerfile`,
            `${dockerOutputDir}/Dockerfile`,
          ),
          `docker build --platform linux/arm64 -t ${dockerImageTag} ${dockerOutputDir}`,
        ],
        parallel: false,
      },
      dependsOn: ['bundle'],
    };

    addDependencyToTargetIfNotPresent(project, 'docker', dockerTargetName);
    addDependencyToTargetIfNotPresent(project, 'build', 'docker');

    // Add shared constructs
    const iacProvider = await resolveIacProvider(tree, options.iacProvider);
    await sharedConstructsGenerator(tree, { iacProvider });

    await addAgentInfra(tree, {
      agentNameKebabCase: name,
      agentNameClassName,
      projectName: project.name,
      dockerImageTag,
      dockerOutputDir,
      iacProvider,
      auth,
      serverProtocol: protocol,
    });
  }

  // Add dependencies
  addDependenciesToPackageJson(
    tree,
    withVersions([
      'zod',
      '@strands-agents/sdk',
      '@aws-sdk/credential-providers',
      '@aws-sdk/client-appconfigdata',
      '@aws-lambda-powertools/parameters',
      '@modelcontextprotocol/sdk',
      ...(protocol === 'A2A'
        ? (['express', '@a2a-js/sdk'] as const)
        : ([
            '@trpc/server',
            '@trpc/client',
            'ws',
            'cors',
            'aws4fetch',
          ] as const)),
    ]),
    withVersions([
      'tsx',
      '@types/node',
      ...(protocol === 'A2A'
        ? (['@types/express'] as const)
        : (['@types/ws', '@types/cors'] as const)),
    ]),
  );

  // A2A servers use port 9000 as per the Strands A2A SDK default and AgentCore A2A contract.
  // HTTP agents use port 8081+ to avoid conflict with VS Code server on 8080.
  const localDevPortStart = protocol === 'A2A' ? 9000 : 8081;
  const localDevPort = assignPort(tree, project, localDevPortStart);

  // Emit the per-protocol interactive CLI under scripts/<agent>/cli.ts.
  // The CLI connects to the locally-running agent by default, or to the
  // deployed agent when RUNTIME_CONFIG_APP_ID is set.
  const scriptsDir = joinPathFragments(
    project.root,
    'scripts',
    agentTargetPrefix,
  );
  const relativeAgentImport = `../../${targetSourceDirRelativeToProjectRoot}`;
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'scripts', protocol.toLowerCase()),
    scriptsDir,
    {
      npmScope: getNpmScope(tree),
      agentNameClassName,
      localDevPort,
      auth,
      relativeAgentImport,
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  updateProjectConfiguration(tree, project.name, {
    ...project,
    targets: {
      ...project.targets,
      [`${agentTargetPrefix}-serve`]: {
        executor: 'nx:run-commands',
        options: {
          commands: [`tsx --watch ${relativeSourceDir}/index.ts`],
          cwd: '{projectRoot}',
          env: {
            PORT: `${localDevPort}`,
          },
        },
        continuous: true,
      },
      [`${agentTargetPrefix}-serve-local`]: {
        executor: 'nx:run-commands',
        options: {
          commands: [`tsx --watch ${relativeSourceDir}/index.ts`],
          cwd: '{projectRoot}',
          env: {
            PORT: `${localDevPort}`,
            SERVE_LOCAL: 'true',
          },
        },
        continuous: true,
      },
      [`${agentTargetPrefix}-invoke`]: {
        executor: 'nx:run-commands',
        options: {
          commands: [`tsx ./scripts/${agentTargetPrefix}/cli.ts`],
          cwd: '{projectRoot}',
          env: {
            PORT: `${localDevPort}`,
          },
        },
      },
    },
  });

  addComponentGeneratorMetadata(
    tree,
    project.name,
    TS_STRANDS_AGENT_GENERATOR_INFO,
    targetSourceDirRelativeToProjectRoot,
    agentTargetPrefix,
    { port: localDevPort, rc: agentNameClassName, auth, protocol },
  );

  await addGeneratorMetricsIfApplicable(tree, [
    TS_STRANDS_AGENT_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

export default tsStrandsAgentGenerator;
