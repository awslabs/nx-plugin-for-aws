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

    const dockerTargetName = `${agentTargetPrefix}-docker`;

    project.targets[dockerTargetName] = {
      cache: true,
      executor: 'nx:run-commands',
      options: {
        command: `docker build --platform linux/arm64 -t ${dockerImageTag} ${targetSourceDir} --build-context workspace=.`,
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
