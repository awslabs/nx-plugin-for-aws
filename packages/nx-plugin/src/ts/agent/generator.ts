/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { addTsDependencies } from '../../utils/add-dependencies';
import { addAgentChatScripts } from '../../utils/agent-chat/agent-chat';
import {
  AGENT_CONNECTION_DEPENDENCIES,
  addTypeScriptFrameworkBase,
  ensureTypeScriptAgentConnectionProject,
} from '../../utils/agent-connection/agent-connection';
import { addAgentInfra } from '../../utils/agent-core-constructs/agent-core-constructs';
import {
  addTypeScriptBundleTarget,
  BUNDLE_DEPENDENCIES,
} from '../../utils/bundle/bundle';
import { resolveContainers } from '../../utils/containers';
import {
  declareDependencies,
  ownedElsewhere,
} from '../../utils/declared-dependencies';
import {
  addDockerScanTarget,
  DOCKER_DEPENDENCIES,
  nodeImageVersions,
} from '../../utils/docker';
import { formatFilesInSubtree } from '../../utils/format';
import { FS_DEPENDENCIES, FsCommands } from '../../utils/fs';
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
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../utils/shared-constructs';
import type { IacMetadata } from '../../utils/shared-constructs-constants';
import { BASE_IMAGES, TS_VERSIONS, withVersions } from '../../utils/versions';
import type { TsAgentGeneratorSchema } from './schema';

/** The metadata this generator records, which its predicates read. */
export interface TsAgentMetadata extends IacMetadata {
  readonly port: number;
  readonly rc: string;
  readonly auth: string;
  readonly protocol: string;
}

// Each entry names the branch it belongs to, so the same declaration drives both
// adding and the version sync.
export const DEPENDENCIES = declareDependencies<TsAgentMetadata>()({
  ts: [
    { name: 'zod' },
    { name: '@strands-agents/sdk' },
    { name: '@aws-sdk/credential-providers' },
    { name: '@aws-sdk/client-appconfigdata' },
    { name: '@aws-lambda-powertools/parameters' },
    { name: '@modelcontextprotocol/sdk' },
    { name: 'express', when: (m) => m.protocol !== 'http' },
    { name: '@a2a-js/sdk', when: (m) => m.protocol === 'a2a' },
    { name: '@ag-ui/aws-strands', when: (m) => m.protocol === 'ag-ui' },
    // @ag-ui/aws-strands declares these as peer dependencies but statically
    // imports them, so they must be installed for the bundler to inline them.
    { name: '@ag-ui/a2ui-toolkit', when: (m) => m.protocol === 'ag-ui' },
    { name: '@ag-ui/client', when: (m) => m.protocol === 'ag-ui' },
    { name: '@ag-ui/core', when: (m) => m.protocol === 'ag-ui' },
    { name: '@ag-ui/encoder', when: (m) => m.protocol === 'ag-ui' },
    { name: '@trpc/server', when: (m) => m.protocol === 'http' },
    { name: '@trpc/client', when: (m) => m.protocol === 'http' },
    { name: 'ws', when: (m) => m.protocol === 'http' },
    { name: 'cors', when: (m) => m.protocol !== 'a2a' },
    { name: 'aws4fetch', when: (m) => m.protocol === 'http' },
    { name: 'aws4fetch', when: (m) => m.auth === 'iam', dev: true },
    {
      name: '@aws-sdk/credential-providers',
      when: (m) => m.auth === 'iam',
      dev: true,
    },
    { name: '@types/node', dev: true },
    // The chat CLI runs standalone via tsx and resolves the deployed agent from
    // AppConfig when `RUNTIME_CONFIG_APP_ID` is set.
    { name: 'agent-chat-cli', dev: true },
    { name: '@aws-lambda-powertools/parameters', dev: true },
    { name: '@aws-sdk/client-appconfigdata', dev: true },
    // A2A chat builds a signed @a2a-js client factory for the deployed agent.
    { name: '@a2a-js/sdk', when: (m) => m.protocol === 'a2a', dev: true },
    { name: '@types/express', when: (m) => m.protocol !== 'http', dev: true },
    { name: '@types/ws', when: (m) => m.protocol === 'http', dev: true },
    { name: '@types/cors', dev: true },
    { name: 'tsx', dev: true, root: true },
    ...ownedElsewhere(AGENT_CONNECTION_DEPENDENCIES),
    ...ownedElsewhere(BUNDLE_DEPENDENCIES),
    ...ownedElsewhere(FS_DEPENDENCIES),
    ...ownedElsewhere(DOCKER_DEPENDENCIES),
    ...ownedElsewhere(SHARED_CONSTRUCTS_DEPENDENCIES),
  ],
});

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

  // Recorded in the metadata below so the version sync can tell a CDK
  // project from a Terraform one; undefined when no infrastructure was
  // generated, in which case neither provider's packages were added.
  const iac =
    infra !== 'none' ? await resolveIac(tree, options.iac) : undefined;

  if (infra === 'none' && options.auth && options.auth !== 'iam') {
    console.warn(
      'Warning: auth is ignored when no infrastructure is configured (no infrastructure is generated)',
    );
  }

  const auth = options.auth ?? 'iam';

  const session = options.session ?? 's3';

  if (infra === 'none' && session !== 'in-memory') {
    console.warn(
      'Warning: session is ignored when no infrastructure is configured (no infrastructure is generated)',
    );
  }

  // Local-dev session storage lives at the workspace root
  // (`tmp/agents/strands/<agent-name>`), not inside the project, so each agent
  // gets its own storage directory. The `-dev`/`-serve` targets run with
  // cwd={projectRoot}, so compute that directory relative to the project root
  // here rather than resolving it at runtime (e.g. via import.meta.url),
  // which would need an extra runtime helper.
  const projectDepth = project.root.split('/').filter(Boolean).length;
  const localSessionsDir = joinPathFragments(
    Array(projectDepth).fill('..').join('/'),
    `tmp/agents/strands/${name}`,
  );

  // Ensure the shared agent-connection project exists so the server entry
  // point can import `runWithSessionId` and propagate the AgentCore session
  // ID to any downstream MCP / A2A clients a later connection generator
  // wires into this agent.
  await ensureTypeScriptAgentConnectionProject(tree, DEPENDENCIES);
  // The agent server imports the framework base helpers (session cache + model
  // error logging) regardless of whether a connection client is wired in.
  await addTypeScriptFrameworkBase(tree, DEPENDENCIES);

  const templateContext = {
    name,
    agentNameClassName,
    distDir,
    protocol,
    session,
    localSessionsDir,
    agentConnectionImport: `@${getNpmScope(tree)}/agent-connection`,
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
    await addTypeScriptBundleTarget(
      tree,
      project,
      {
        targetFilePath: `${targetSourceDirRelativeToProjectRoot}/index.ts`,
        bundleOutputDir: joinPathFragments('agent', name),
      },
      DEPENDENCIES,
    );

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
        ...nodeImageVersions(),
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

    const fs = new FsCommands(tree, DEPENDENCIES);
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

    addDockerScanTarget(
      tree,
      {
        project,
        containerEngine: containers,
        trivyTargetName: `${agentTargetPrefix}-trivy`,
        dockerTargetName,
        imageTags: [dockerImageTag],
      },
      DEPENDENCIES,
    );

    // Add shared constructs
    await sharedConstructsGenerator(tree, { iac }, DEPENDENCIES);

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
      session,
      serverProtocol: infraProtocol,
      containers,
    });
  }

  // A2A servers use port 9000 as per the Strands A2A SDK default and AgentCore A2A contract.
  // HTTP and AG-UI agents use port 8081+ to avoid conflict with VS Code server on 8080.
  const localDevPortStart = protocol === 'a2a' ? 9000 : 8081;
  const localDevPort = assignPort(tree, project, localDevPortStart, {
    component: { info: TS_AGENT_GENERATOR_INFO, name: agentTargetPrefix },
  });

  // Recorded below and read by the declaration's predicates, so the packages
  // added here are exactly the ones the version sync will own.
  const metadata: TsAgentMetadata = {
    port: localDevPort,
    rc: agentNameClassName,
    auth,
    protocol,
    ...(iac ? { iac } : {}),
  };

  addTsDependencies(tree, DEPENDENCIES, {
    metadata,
    projectRoot: project.root,
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
    metadata,
  );

  await addGeneratorMetricsIfApplicable(tree, [TS_AGENT_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript'],
    });
};

export default tsAgentGenerator;
