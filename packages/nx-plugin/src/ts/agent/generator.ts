/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { addAgentChatScripts } from '../../utils/agent-chat/agent-chat';
import {
  addTypeScriptFrameworkBase,
  ensureTypeScriptAgentConnectionProject,
} from '../../utils/agent-connection/agent-connection';
import { addAgentInfra } from '../../utils/agent-core-constructs/agent-core-constructs';
import { addTypeScriptBundleTarget } from '../../utils/bundle/bundle';
import { resolveContainers } from '../../utils/containers';
import { addDockerScanTarget } from '../../utils/docker';
import { formatFilesInSubtree } from '../../utils/format';
import { FsCommands } from '../../utils/fs';
import { resolveIac } from '../../utils/iac';
import { installDependencies } from '../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { esmVars } from '../../utils/module-format';
import { kebabCase, toClassName } from '../../utils/names';
import { getNpmScope } from '../../utils/npm-scope';
import {
  addComponentDevTarget,
  addComponentGeneratorMetadata,
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { sortObjectKeys } from '../../utils/object';
import { assignPort } from '../../utils/port';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { BASE_IMAGES, TS_VERSIONS, withVersions } from '../../utils/versions';
import type { TsAgentGeneratorSchema } from './schema';

export const TS_AGENT_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

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
  // The agent server imports the framework base helpers (session cache + model
  // error logging) regardless of whether a connection client is wired in.
  await addTypeScriptFrameworkBase(tree);

  const templateContext = {
    name,
    agentNameClassName,
    distDir,
    agentConnectionImport: `:${getNpmScope(tree)}/agent-connection`,
    ...esmVars(tree),
  };

  // Generate common files shared by both protocols
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'common'),
    targetSourceDir,
    templateContext,
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Generate protocol-specific files
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', protocol.toLowerCase()),
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
      joinPathFragments(import.meta.dirname, 'files', 'deploy'),
      targetSourceDir,
      {
        distDir,
        name,
        protocol,
        adotVersion:
          TS_VERSIONS['@aws/aws-distro-opentelemetry-node-autoinstrumentation'],
        jaegerVersion: TS_VERSIONS['@opentelemetry/propagator-jaeger'],
        nodeBaseImage: BASE_IMAGES.node,
        npmVersion: TS_VERSIONS.npm,
        ...esmVars(tree),
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

    addDockerScanTarget(tree, {
      project,
      containerEngine: containers,
      trivyTargetName: `${agentTargetPrefix}-trivy`,
      dockerTargetName,
      imageTags: [dockerImageTag],
    });

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
              // @ag-ui/aws-strands declares these as peer dependencies but
              // statically imports them, so they must be installed for the
              // bundler to resolve and inline them into the runtime image.
              '@ag-ui/a2ui-toolkit',
              '@ag-ui/client',
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
      // The chat CLI runs standalone via tsx for every protocol, and resolves
      // the deployed agent from AppConfig when `RUNTIME_CONFIG_APP_ID` is set.
      'tsx',
      '@types/node',
      'agent-chat-cli',
      '@aws-lambda-powertools/parameters',
      '@aws-sdk/client-appconfigdata',
      ...(auth === 'iam'
        ? (['aws4fetch', '@aws-sdk/credential-providers'] as const)
        : ([] as const)),
      // A2A chat builds a signed @a2a-js client factory for the deployed agent.
      ...(protocol === 'a2a' ? (['@a2a-js/sdk'] as const) : ([] as const)),
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

  // Every protocol gets a standalone `chat.ts`. It connects to the local
  // `dev` server by default, or to the deployed agent (with the
  // appropriate auth) when `RUNTIME_CONFIG_APP_ID` is set.
  const scriptsDir = joinPathFragments(
    project.root,
    'scripts',
    agentTargetPrefix,
  );
  addAgentChatScripts(tree, {
    scriptsDir,
    protocol,
    language: 'ts',
    agentNameClassName,
    auth,
    relativeAgentImport: `../../${targetSourceDirRelativeToProjectRoot}`,
  });

  const chatUrl =
    protocol === 'http'
      ? `ws://localhost:${localDevPort}/ws`
      : protocol === 'ag-ui'
        ? `http://localhost:${localDevPort}/invocations`
        : `http://localhost:${localDevPort}`;
  const chatCommand = `tsx ./scripts/${agentTargetPrefix}/chat.ts`;

  const agentTargets = {
    ...project.targets,
    [`${agentTargetPrefix}-serve`]: {
      executor: 'nx:run-commands',
      continuous: true,
      options: {
        commands: [`tsx --watch ${relativeSourceDir}/index.ts`],
        cwd: '{projectRoot}',
        env: {
          PORT: `${localDevPort}`,
        },
      },
    },
    [`${agentTargetPrefix}-dev`]: {
      executor: 'nx:run-commands',
      continuous: true,
      options: {
        commands: [`tsx --watch ${relativeSourceDir}/index.ts`],
        cwd: '{projectRoot}',
        env: {
          PORT: `${localDevPort}`,
          LOCAL_DEV: 'true',
        },
      },
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
    },
  };

  // Aggregate `<agent>-dev` under the project-level `dev` target.
  addComponentDevTarget(agentTargets, `${agentTargetPrefix}-dev`);

  updateProjectConfiguration(tree, project.name, {
    ...project,
    // Sort targets so their order is stable regardless of insertion order on
    // first run vs re-run.
    targets: sortObjectKeys(agentTargets),
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
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript'],
    });
};

export default tsAgentGenerator;
