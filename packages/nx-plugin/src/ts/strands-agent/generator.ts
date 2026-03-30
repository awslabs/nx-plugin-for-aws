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

  // Generate example agent
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'app'),
    targetSourceDir,
    {
      name,
      agentNameClassName,
      distDir,
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  if (computeType === 'BedrockAgentCoreRuntime') {
    const dockerImageTag = `${getNpmScope(tree)}-${name}:latest`;

    // Add bundle target
    addTypeScriptBundleTarget(tree, project, {
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
        adotVersion:
          TS_VERSIONS['@aws/aws-distro-opentelemetry-node-autoinstrumentation'],
      },
      { overwriteStrategy: OverwriteStrategy.KeepExisting },
    );

    // Add shared constructs
    const iacProvider = await resolveIacProvider(tree, options.iacProvider);
    await sharedConstructsGenerator(tree, { iacProvider });

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

    // For Terraform, the docker image must be pre-built before deploy.
    // For CDK, the image is built via DockerImageAsset with buildContexts.
    if (iacProvider !== 'CDK') {
      addDependencyToTargetIfNotPresent(project, 'build', 'docker');
    }

    await addAgentInfra(tree, {
      agentNameKebabCase: name,
      agentNameClassName,
      projectName: project.name,
      dockerImageTag,
      dockerfileDir: targetSourceDir,
      bundleOutputDir: joinPathFragments(distDir, 'bundle', 'agent', name),
      iacProvider,
    });
  }

  // Add dependencies
  addDependenciesToPackageJson(
    tree,
    withVersions([
      '@trpc/server',
      '@trpc/client',
      'zod',
      '@strands-agents/sdk',
      'ws',
      'cors',
      '@aws-sdk/credential-providers',
      '@aws-sdk/client-appconfigdata',
      '@aws-lambda-powertools/parameters',
      'aws4fetch',
      '@modelcontextprotocol/sdk',
    ]),
    withVersions(['tsx', '@types/ws', '@types/cors', '@types/node']),
  );

  // NB: we assign the local dev port from 8081 as 8080 is used by vscode server, and so conflicts
  // for those working on remote dev envirionments. The deployed agent in agentcore still runs on
  // 8080 as per the agentcore contract.
  const localDevPort = assignPort(tree, project, 8081);

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
    { port: localDevPort, rc: agentNameClassName },
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
