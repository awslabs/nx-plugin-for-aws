/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  type GeneratorCallback,
  generateFiles,
  installPackagesTask,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { ensureTypeScriptAgentConnectionProject } from '../../utils/agent-connection/agent-connection';
import { addAgentInfra } from '../../utils/agent-core-constructs/agent-core-constructs';
import { addTypeScriptBundleTarget } from '../../utils/bundle/bundle';
import { resolveContainers } from '../../utils/containers';
import { formatFilesInSubtree } from '../../utils/format';
import { FsCommands } from '../../utils/fs';
import { resolveIac } from '../../utils/iac';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { kebabCase, toClassName } from '../../utils/names';
import { getNpmScope } from '../../utils/npm-scope';
import {
  addComponentGeneratorMetadata,
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { sortObjectKeys } from '../../utils/object';
import { assignPort } from '../../utils/port';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { TS_VERSIONS, withVersions } from '../../utils/versions';
import type { TsAgentGeneratorSchema } from './schema';

export const TS_AGENT_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const tsAgentGenerator = async (
  tree: Tree,
  options: TsAgentGeneratorSchema,
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

  const infra = options.infra ?? 'agentcore';
  const protocol = options.protocol ?? 'http';

  if (infra === 'none' && options.auth && options.auth !== 'iam') {
    console.warn(
      'Warning: auth is ignored when no infrastructure is configured (no infrastructure is generated)',
    );
  }

  const auth = options.auth ?? 'iam';

  // Ensure the shared agent-connection project exists so the server entry
  // point can import `runWithSessionId` and propagate the AgentCore session
  // ID to any downstream MCP / A2A clients a later connection generator
  // wires into this agent.
  await ensureTypeScriptAgentConnectionProject(tree);

  const templateContext = {
    name,
    agentNameClassName,
    distDir,
    agentConnectionImport: `:${getNpmScope(tree)}/agent-connection`,
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

  if (infra === 'agentcore') {
    const containers = await resolveContainers(tree, 'inherit');
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
      outputs: [`{workspaceRoot}/${dockerOutputDir}/Dockerfile`],
      executor: 'nx:run-commands',
      options: {
        commands: [
          fs.cp(
            `${targetSourceDir}/Dockerfile`,
            `${dockerOutputDir}/Dockerfile`,
          ),
          `${containers} build --platform linux/arm64 -t ${dockerImageTag} ${dockerOutputDir}`,
        ],
        parallel: false,
      },
      dependsOn: ['bundle'],
    };

    addDependencyToTargetIfNotPresent(project, 'docker', dockerTargetName);
    addDependencyToTargetIfNotPresent(project, 'build', 'docker');

    // Add shared constructs
    const iac = await resolveIac(tree, options.iac);
    await sharedConstructsGenerator(tree, { iac });

    // AG-UI uses HTTP as the AgentCore protocol type (AG-UI is HTTP-based with SSE over POST).
    const infraProtocol: 'http' | 'a2a' =
      protocol === 'ag-ui' ? 'http' : (protocol as 'http' | 'a2a');

    await addAgentInfra(tree, {
      agentNameKebabCase: name,
      agentNameClassName,
      projectName: project.name,
      dockerImageTag,
      dockerOutputDir,
      iac,
      auth,
      serverProtocol: infraProtocol,
      containers,
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
      ...(protocol === 'a2a'
        ? (['express', '@a2a-js/sdk'] as const)
        : protocol === 'ag-ui'
          ? ([
              '@ag-ui/aws-strands',
              '@ag-ui/core',
              '@ag-ui/encoder',
              'express',
              'cors',
            ] as const)
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
      'agent-chat-cli',
      ...(protocol === 'a2a' || protocol === 'ag-ui'
        ? (['@types/express', '@types/cors'] as const)
        : (['@types/ws', '@types/cors'] as const)),
    ]),
  );

  // A2A servers use port 9000 as per the Strands A2A SDK default and AgentCore A2A contract.
  // HTTP and AG-UI agents use port 8081+ to avoid conflict with VS Code server on 8080.
  const localDevPortStart = protocol === 'a2a' ? 9000 : 8081;
  const localDevPort = assignPort(tree, project, localDevPortStart, {
    component: { info: TS_AGENT_GENERATOR_INFO, name: agentTargetPrefix },
  });

  // HTTP chat needs a tiny generated script to wrap the project's tRPC
  // WebSocket client in a `ChatAdapter`. A2A speaks the standard A2A
  // protocol, so we can run `agent-chat-cli` directly as a binary.
  if (protocol === 'http') {
    const scriptsDir = joinPathFragments(
      project.root,
      'scripts',
      agentTargetPrefix,
    );
    const relativeAgentImport = `../../${targetSourceDirRelativeToProjectRoot}`;
    generateFiles(
      tree,
      joinPathFragments(__dirname, 'scripts', 'http'),
      scriptsDir,
      {
        agentNameClassName,
        agentTargetPrefix,
        localDevPort,
        relativeAgentImport,
      },
      { overwriteStrategy: OverwriteStrategy.KeepExisting },
    );
  }

  const chatUrl =
    protocol === 'http'
      ? `ws://localhost:${localDevPort}/ws`
      : protocol === 'ag-ui'
        ? `http://localhost:${localDevPort}/invocations`
        : `http://localhost:${localDevPort}`;
  const chatCommand =
    protocol === 'http'
      ? `tsx ./scripts/${agentTargetPrefix}/chat.ts`
      : protocol === 'ag-ui'
        ? `agent-chat-cli agui ${chatUrl}`
        : `agent-chat-cli a2a ${chatUrl}`;

  updateProjectConfiguration(tree, project.name, {
    ...project,
    // Sort targets so their order is stable regardless of insertion order on
    // first run vs re-run.
    targets: sortObjectKeys({
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
      [`${agentTargetPrefix}-chat`]: {
        executor: 'nx:run-commands',
        options: {
          commands: [chatCommand],
          cwd: '{projectRoot}',
          env: {
            URL: chatUrl,
          },
        },
        dependsOn: [`${agentTargetPrefix}-serve-local`],
      },
    }),
  });

  addComponentGeneratorMetadata(
    tree,
    project.name,
    TS_AGENT_GENERATOR_INFO,
    targetSourceDirRelativeToProjectRoot,
    agentTargetPrefix,
    { port: localDevPort, rc: agentNameClassName, auth, protocol },
  );

  await addGeneratorMetricsIfApplicable(tree, [TS_AGENT_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

export default tsAgentGenerator;
