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
import { ensureLicenseExceptions } from '../../license/config';
import { AG_UI_LANGGRAPH_EXCEPTIONS } from '../../license/known-exceptions';
import {
  addPyDependencies,
  addTsDependencies,
} from '../../utils/add-dependencies';
import { addAgentChatScripts } from '../../utils/agent-chat/agent-chat';
import {
  AGENT_CONNECTION_PY_DEPENDENCIES,
  addPythonFrameworkBase,
  ensureLangchainS3CheckpointSaver,
  ensurePythonAgentConnectionProject,
  getPythonAgentConnectionModuleName,
  getPythonAgentConnectionProject,
} from '../../utils/agent-connection/agent-connection';
import { addAgentInfra } from '../../utils/agent-core-constructs/agent-core-constructs';
import { addPythonBundleTarget } from '../../utils/bundle/bundle';
import { resolveContainers } from '../../utils/containers';
import {
  declareDependencies,
  ownedElsewhere,
} from '../../utils/declared-dependencies';
import { addDockerScanTarget, DOCKER_DEPENDENCIES } from '../../utils/docker';
import { formatFilesInSubtree } from '../../utils/format';
import { FS_DEPENDENCIES, FsCommands } from '../../utils/fs';
import { updateGitIgnore } from '../../utils/git';
import { resolveIac } from '../../utils/iac';
import { installDependencies } from '../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { kebabCase, toClassName, toSnakeCase } from '../../utils/names';
import { getNpmScope } from '../../utils/npm-scope';
import {
  addComponentDevTarget,
  addComponentGeneratorMetadata,
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  normalizeTargetKeyOrder,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { sortObjectKeys } from '../../utils/object';
import {
  getRelativePathToRootByDirectory,
  toProjectRelativePath,
} from '../../utils/paths';
import { assignPort } from '../../utils/port';
import { addWorkspaceDependencyToPyProject } from '../../utils/py';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../utils/shared-constructs';
import type { IacMetadata } from '../../utils/shared-constructs-constants';
import { BASE_IMAGES } from '../../utils/versions';
import type {
  AgentProtocol,
  PyAgentFramework,
  PyAgentGeneratorSchema,
  PyAgentSession,
} from './schema';

/** The metadata this generator records, which its predicates read. */
export interface PyAgentMetadata extends IacMetadata {
  readonly port: number;
  readonly rc: string;
  readonly auth: string;
  readonly protocol: AgentProtocol;
  /**
   * The mcp / gateway connection generators dispatch on this field to pick the
   * Strands vs LangChain Layer-2 client + agent.py transform.
   */
  readonly framework: PyAgentFramework;
  readonly session: string;
}

/** Whether the chat CLI signs its requests, which only IAM auth needs. */
const isIam = (m: PyAgentMetadata) => m.auth === 'iam';

// Each entry names the framework and protocol branch it belongs to, so the same
// declaration drives both adding and the version sync.
export const DEPENDENCIES = declareDependencies<PyAgentMetadata>()({
  ts: [
    // The chat CLI, which runs standalone via tsx for every protocol and
    // resolves the deployed agent from AppConfig. `agent-chat-cli` transitively
    // bundles the protocol clients (@a2a-js/sdk, @ag-ui/client).
    { name: 'agent-chat-cli', dev: true, root: true },
    { name: 'tsx', dev: true, root: true },
    { name: '@types/node', dev: true, root: true },
    { name: '@aws-lambda-powertools/parameters', dev: true, root: true },
    { name: '@aws-sdk/client-appconfigdata', dev: true, root: true },
    { name: 'aws4fetch', when: isIam, dev: true, root: true },
    {
      name: '@aws-sdk/credential-providers',
      when: isIam,
      dev: true,
      root: true,
    },
    {
      name: '@a2a-js/sdk',
      when: (m) => m.protocol === 'a2a',
      dev: true,
      root: true,
    },
    // Added by the helpers that own the projects they belong to.
    ...ownedElsewhere(FS_DEPENDENCIES),
    ...ownedElsewhere(DOCKER_DEPENDENCIES),
    ...ownedElsewhere(SHARED_CONSTRUCTS_DEPENDENCIES),
  ],
  py: [
    { name: 'aws-lambda-powertools' },
    { name: 'aws-opentelemetry-distro' },
    { name: 'bedrock-agentcore' },
    { name: 'boto3' },
    { name: 'fastapi' },
    { name: 'mcp' },
    // langchain pulls no Strands dependencies — the langchain model binding
    // plus the per-protocol server adapter: ag-ui-langgraph for AG-UI, a2a-sdk
    // for A2A, nothing extra for HTTP (FastAPI is added for every agent).
    { name: 'langchain', when: (m) => m.framework === 'langchain' },
    { name: 'langchain-aws', when: (m) => m.framework === 'langchain' },
    { name: 'langgraph', when: (m) => m.framework === 'langchain' },
    // Local dev uses a SQLite-backed checkpointer for convenience (parity
    // with the strands framework's local FileSessionManager).
    {
      name: 'langgraph-checkpoint-sqlite',
      when: (m) => m.framework === 'langchain',
    },
    // AsyncSqliteSaver's driver, required alongside langgraph-checkpoint-sqlite.
    { name: 'aiosqlite', when: (m) => m.framework === 'langchain' },
    // Provides DynamoDBSaver (with S3 offloading for large checkpoints).
    {
      name: 'langgraph-checkpoint-aws',
      when: (m) => m.framework === 'langchain' && m.session === 'dynamodb-s3',
    },
    {
      name: 'ag-ui-protocol',
      when: (m) => m.framework === 'langchain' && m.protocol === 'ag-ui',
    },
    {
      name: 'ag-ui-langgraph',
      when: (m) => m.framework === 'langchain' && m.protocol === 'ag-ui',
    },
    {
      name: 'a2a-sdk',
      when: (m) => m.framework === 'langchain' && m.protocol === 'a2a',
    },
    {
      name: 'strands-agents[a2a]',
      when: (m) => m.framework === 'strands' && m.protocol === 'a2a',
    },
    {
      name: 'strands-agents',
      when: (m) => m.framework === 'strands' && m.protocol !== 'a2a',
    },
    {
      name: 'strands-agents-tools',
      when: (m) => m.framework === 'strands',
    },
    // Declared again here so a Strands AG-UI agent lists it in the same order
    // the generated pyproject.toml had before.
    {
      name: 'ag-ui-protocol',
      when: (m) => m.framework === 'strands' && m.protocol === 'ag-ui',
    },
    {
      name: 'ag-ui-strands',
      when: (m) => m.framework === 'strands' && m.protocol === 'ag-ui',
    },
    { name: 'uvicorn' },
    // `fastapi dev` runs the local server for every protocol.
    { name: 'fastapi[standard]', group: 'dev' },
    // The agent-connection helper adds these to its own project.
    ...ownedElsewhere(AGENT_CONNECTION_PY_DEPENDENCIES),
  ],
});

export const PY_AGENT_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

export const pyAgentGenerator = async (
  tree: Tree,
  options: PyAgentGeneratorSchema,
): Promise<GeneratorCallback> => {
  const project = readProjectConfigurationUnqualified(tree, options.project);

  const pyProjectPath = joinPathFragments(project.root, 'pyproject.toml');

  // Check if the project has a pyproject.toml file
  if (!pyProjectPath) {
    throw new Error(
      `Unsupported project ${options.project}. Expected a Python project (with a pyproject.toml)`,
    );
  }

  if (!project.sourceRoot) {
    throw new Error(
      `This project does not have a source root. Please add a source root to the project configuration before running this generator.`,
    );
  }

  // Module name is the last part of the source root,
  const sourceParts = project.sourceRoot.split('/');
  const moduleName = sourceParts[sourceParts.length - 1];

  const name = kebabCase(
    options.name || `${kebabCase(project.name.split('.').pop())}-agent`,
  );
  const agentTargetPrefix = options.name ? name : 'agent';

  const agentNameSnakeCase = toSnakeCase(options.name || 'agent');
  const agentNameClassName = toClassName(name);

  const targetSourceDir = joinPathFragments(
    project.sourceRoot,
    agentNameSnakeCase,
  );

  const infra = options.infra ?? 'agentcore';
  const protocol = options.protocol ?? 'http';
  const framework = options.framework ?? 'strands';

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

  // Session backends are framework-specific: Strands' SessionManager only has
  // an S3-backed implementation here (via strands.session.S3SessionManager),
  // while LangChain uses dedicated S3 and DynamoDB checkpointer libraries.
  // 'in-memory' is valid for both.
  const SESSIONS_BY_FRAMEWORK: Record<
    PyAgentFramework,
    readonly PyAgentSession[]
  > = {
    strands: ['s3', 'in-memory'],
    langchain: ['s3', 'dynamodb-s3', 'in-memory'],
  };
  if (
    options.session &&
    !SESSIONS_BY_FRAMEWORK[framework].includes(options.session)
  ) {
    throw new Error(
      `Unsupported combination: session '${options.session}' is not implemented for the ${framework} framework (supported: ${SESSIONS_BY_FRAMEWORK[framework].join(', ')}).`,
    );
  }
  const session = options.session ?? 's3';

  if (infra === 'none' && session !== 'in-memory') {
    console.warn(
      'Warning: session is ignored when no infrastructure is configured (no infrastructure is generated)',
    );
  }

  // Local-dev session storage lives at the workspace root
  // (`tmp/agents/<framework>/<agent-name>`), not inside the project, so each
  // agent gets its own storage directory — shared by both frameworks
  // (Strands' FileSessionManager, LangChain's SqliteSaver). The
  // `-dev`/`-serve` targets run with cwd={projectRoot}, so compute that
  // directory relative to the project root here rather than resolving it at
  // runtime.
  const localSessionsDir = joinPathFragments(
    getRelativePathToRootByDirectory(project.root),
    `tmp/agents/${framework}/${name}`,
  );

  // Ensure the shared agent-connection project exists so the server entry
  // point can import `session_id_context` and propagate the AgentCore
  // session ID to any downstream MCP / A2A clients a later connection
  // generator wires into this agent.
  await ensurePythonAgentConnectionProject(tree, DEPENDENCIES);
  // The agent server imports the framework base helpers (session cache + model
  // error logging) regardless of whether a connection client is wired in. The
  // LangChain framework has no base layer (its AG-UI foundation reuses only the
  // framework-agnostic session context), so this is a no-op for LangChain.
  await addPythonFrameworkBase(tree, DEPENDENCIES, framework);
  const agentConnectionModuleName = getPythonAgentConnectionModuleName(tree);
  addWorkspaceDependencyToPyProject(
    tree,
    project,
    getPythonAgentConnectionProject(tree),
  );

  const templateContext = {
    name,
    agentNameSnakeCase,
    agentNameClassName,
    moduleName,
    agentConnectionModuleName,
    framework,
    protocol,
    session,
    localSessionsDir,
  };

  // Files live under a per-framework dir (files/strands, files/langchain),
  // mirrored one-for-one — including files that don't vary by framework
  // (e.g. the empty package __init__.py) — so there's a single, uniform
  // <framework>/<protocol> layout with no cross-framework fallbacks.
  // `framework` is itself the directory name.

  // Common files shared by both protocols: the agent module (Strands yields a
  // contextmanaged Agent with a session.py sibling; LangChain returns a
  // compiled create_agent graph) and the package __init__.py.
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', framework, 'common'),
    targetSourceDir,
    templateContext,
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  if (framework === 'langchain' && session === 's3') {
    ensureLangchainS3CheckpointSaver(tree);
  }

  // Protocol-specific files. Each protocol's server entry point is
  // framework-specific (Strands yields a contextmanaged Agent; LangChain
  // drives a compiled create_agent graph).
  const protocolLower = protocol.toLowerCase();
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', framework, protocolLower),
    targetSourceDir,
    templateContext,
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  if (infra === 'agentcore') {
    const containers = await resolveContainers(tree, 'inherit');
    const dockerImageTag = `${getNpmScope(tree)}-${name}:latest`;

    // Add bundle target
    const { bundleTargetName, bundleOutputDir } = addPythonBundleTarget(
      project,
      {
        pythonPlatform: 'aarch64-manylinux_2_28',
      },
    );

    // Add the Dockerfile
    generateFiles(
      tree,
      joinPathFragments(import.meta.dirname, 'files', 'deploy'),
      targetSourceDir,
      {
        agentNameSnakeCase,
        moduleName,
        bundleOutputDir,
        protocol,
        pythonBaseImage: BASE_IMAGES.python,
      },
      { overwriteStrategy: OverwriteStrategy.KeepExisting },
    );

    const dockerOutputDir = joinPathFragments(
      'dist',
      project.root,
      'docker',
      name,
    );
    const dockerTargetName = `${agentTargetPrefix}-docker`;

    // Add a docker target that prepares the docker context and builds the image
    const fs = new FsCommands(tree, DEPENDENCIES);
    project.targets[dockerTargetName] = {
      cache: true,
      executor: 'nx:run-commands',
      options: {
        commands: [
          fs.rm(dockerOutputDir),
          fs.mkdir(dockerOutputDir),
          fs.cp(bundleOutputDir, dockerOutputDir),
          fs.cp(
            `${targetSourceDir}/Dockerfile`,
            `${dockerOutputDir}/Dockerfile`,
          ),
          `${containers} build --platform linux/arm64 -t ${dockerImageTag} ${dockerOutputDir}`,
        ],
        parallel: false,
      },
      dependsOn: [bundleTargetName],
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

    // Add the construct to deploy the agent.
    // AG-UI uses HTTP as the AgentCore protocol type (AG-UI is HTTP-based with SSE over POST).
    const infraProtocol =
      protocol === 'ag-ui' ? ('http' as const) : (protocol as 'http' | 'a2a');
    await addAgentInfra(tree, {
      agentNameKebabCase: name,
      agentNameClassName,
      dockerImageTag,
      dockerOutputDir,
      iac,
      projectName: project.name,
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
    component: { info: PY_AGENT_GENERATOR_INFO, name: agentTargetPrefix },
  });

  // Recorded below and read by the declaration's predicates, so the packages
  // added here are exactly the ones the version sync will own.
  const metadata: PyAgentMetadata = {
    port: localDevPort,
    rc: agentNameClassName,
    auth,
    protocol,
    framework,
    session,
    ...(iac ? { iac } : {}),
  };

  addPyDependencies(tree, DEPENDENCIES, {
    metadata,
    projectRoot: project.root,
  });
  addTsDependencies(tree, DEPENDENCIES, { metadata });

  // All protocols use fastapi dev for hot reload:
  // - HTTP: FastAPI app directly defined in init.py
  // - A2A: A2AServer.to_fastapi_app() creates a FastAPI app in main.py
  // - AG-UI: create_strands_app() creates a FastAPI app in main.py
  const serveCommand = `uv run fastapi dev ${moduleName}/${agentNameSnakeCase}/main.py --port ${localDevPort}`;

  // HTTP chat uses the type-safe TypeScript client generated from the
  // agent's OpenAPI spec (same generated client the react-connection
  // generator produces). A2A and AG-UI speak standard protocols, so
  // we can run `agent-chat-cli` directly as a binary.
  const openApiTargetName = `${agentTargetPrefix}-openapi`;
  const clientGenTargetName = `${agentTargetPrefix}-generate-client`;

  const scriptsDir = joinPathFragments(
    project.root,
    'scripts',
    agentTargetPrefix,
  );

  if (protocol === 'http') {
    // Emit the OpenAPI spec generator script (shared with react-connection)
    generateFiles(
      tree,
      joinPathFragments(
        import.meta.dirname,
        'react-connection',
        'files',
        'agent',
      ),
      project.root,
      {
        moduleName,
        agentNameSnakeCase,
      },
      { overwriteStrategy: OverwriteStrategy.KeepExisting },
    );

    // Ignore the generated client directory
    updateGitIgnore(tree, project.root, (patterns) => [
      ...patterns,
      `scripts/${agentTargetPrefix}/generated/`,
    ]);
  }

  // Every protocol gets a standalone `chat.ts`. It connects to the local
  // `dev` server by default, or to the deployed agent (with the
  // appropriate auth) when `RUNTIME_CONFIG_APP_ID` is set.
  addAgentChatScripts(tree, {
    scriptsDir,
    protocol,
    language: 'py',
    agentNameClassName,
    auth,
  });

  const chatUrl =
    protocol === 'ag-ui'
      ? `http://localhost:${localDevPort}/invocations`
      : `http://localhost:${localDevPort}`;
  const chatCommand = `tsx ./scripts/${agentTargetPrefix}/chat.ts`;

  const httpOnlyTargets =
    protocol === 'http'
      ? {
          [openApiTargetName]: {
            cache: true,
            executor: 'nx:run-commands',
            outputs: [
              `{workspaceRoot}/dist/{projectRoot}/openapi/${agentNameSnakeCase}`,
            ],
            options: {
              commands: [
                `uv run python {projectRoot}/scripts/${agentNameSnakeCase}_openapi.py "dist/{projectRoot}/openapi/${agentNameSnakeCase}/openapi.json"`,
              ],
            },
          },
          [clientGenTargetName]: {
            cache: true,
            executor: 'nx:run-commands',
            dependsOn: [openApiTargetName],
            inputs: [
              {
                dependentTasksOutputFiles: '**/*.json',
              },
            ],
            outputs: [`{projectRoot}/scripts/${agentTargetPrefix}/generated`],
            options: {
              commands: [
                `nx g @aws/nx-plugin:open-api#ts-client --openApiSpecPath="dist/${project.root}/openapi/${agentNameSnakeCase}/openapi.json" --outputPath="${project.root}/scripts/${agentTargetPrefix}/generated" --no-interactive`,
              ],
            },
          },
        }
      : {};

  const agentTargets = {
    ...project.targets,
    ...httpOnlyTargets,
    [`${agentTargetPrefix}-serve`]: {
      executor: 'nx:run-commands',
      continuous: true,
      options: {
        commands: [serveCommand],
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
        commands: [serveCommand],
        cwd: '{projectRoot}',
        env: {
          PORT: `${localDevPort}`,
          LOCAL_DEV: 'true',
        },
      },
    },
    // HTTP chat imports the generated client, so ensure it's built first.
    // No dev dependency — chat runs standalone against a local or
    // deployed agent. normalizeTargetKeyOrder keeps the conditional dependsOn
    // in Nx 23's serialization order so re-runs stay byte-identical.
    [`${agentTargetPrefix}-chat`]: normalizeTargetKeyOrder({
      executor: 'nx:run-commands',
      options: {
        commands: [chatCommand],
        cwd: '{projectRoot}',
        env: {
          URL: chatUrl,
        },
      },
      ...(protocol === 'http' ? { dependsOn: [clientGenTargetName] } : {}),
    }),
  };

  // Aggregate `<agent>-dev` under the project-level `dev` target.
  addComponentDevTarget(agentTargets, `${agentTargetPrefix}-dev`);

  updateProjectConfiguration(tree, project.name, {
    ...project,
    targets: sortObjectKeys(agentTargets),
  });

  addComponentGeneratorMetadata(
    tree,
    project.name,
    PY_AGENT_GENERATOR_INFO,
    toProjectRelativePath(project, targetSourceDir),
    agentTargetPrefix,
    metadata,
  );

  await addGeneratorMetricsIfApplicable(tree, [PY_AGENT_GENERATOR_INFO]);

  // langchain-core (pulled by every langchain agent regardless of protocol)
  // brings jsonpatch/jsonpointer, whose wheels ship without resolvable SPDX
  // license metadata, so register those exceptions so the workspace license
  // check still passes.
  if (framework === 'langchain') {
    await ensureLicenseExceptions(tree, AG_UI_LANGGRAPH_EXCEPTIONS);
  }

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript', 'python'],
    });
};

export default pyAgentGenerator;
