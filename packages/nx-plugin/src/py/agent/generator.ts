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
import { ensureLicenseExceptions } from '../../license/config';
import { AG_UI_LANGGRAPH_EXCEPTIONS } from '../../license/known-exceptions';
import { addAgentChatScripts } from '../../utils/agent-chat/agent-chat';
import {
  addPythonFrameworkBase,
  ensurePythonAgentConnectionProject,
  getPythonAgentConnectionModuleName,
  getPythonAgentConnectionProject,
} from '../../utils/agent-connection/agent-connection';
import { addAgentInfra } from '../../utils/agent-core-constructs/agent-core-constructs';
import { addPythonBundleTarget } from '../../utils/bundle/bundle';
import { resolveContainers } from '../../utils/containers';
import { addDockerScanTarget } from '../../utils/docker';
import { formatFilesInSubtree } from '../../utils/format';
import { FsCommands } from '../../utils/fs';
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
import { toProjectRelativePath } from '../../utils/paths';
import { assignPort } from '../../utils/port';
import {
  addDependenciesToDependencyGroupInPyProjectToml,
  addDependenciesToPyProjectToml,
  addWorkspaceDependencyToPyProject,
} from '../../utils/py';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { BASE_IMAGES, withVersions } from '../../utils/versions';
import type { PyAgentGeneratorSchema } from './schema';

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

  if (infra === 'none' && options.auth && options.auth !== 'iam') {
    console.warn(
      'Warning: auth is ignored when no infrastructure is configured (no infrastructure is generated)',
    );
  }

  const auth = options.auth ?? 'iam';

  // Ensure the shared agent-connection project exists so the server entry
  // point can import `session_id_context` and propagate the AgentCore
  // session ID to any downstream MCP / A2A clients a later connection
  // generator wires into this agent.
  await ensurePythonAgentConnectionProject(tree);
  // The agent server imports the framework base helpers (session cache + model
  // error logging) regardless of whether a connection client is wired in. The
  // langchain framework has no base layer (its AG-UI foundation reuses only the
  // framework-agnostic session context), so this is a no-op for langchain.
  await addPythonFrameworkBase(tree, framework);
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
  };

  // Generate common files shared by both protocols. The agent module (agent.py)
  // is framework-specific (Strands yields a contextmanaged Agent; LangChain
  // returns a compiled create_agent graph), so it comes from a per-framework
  // dir. The package __init__.py is framework-agnostic (it stays in `common`).
  generateFiles(
    tree,
    joinPathFragments(
      import.meta.dirname,
      'files',
      framework === 'langchain' ? 'common-langchain' : 'common',
    ),
    targetSourceDir,
    templateContext,
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );
  if (framework === 'langchain') {
    // common-langchain only carries agent.py; the empty package __init__.py is
    // framework-agnostic, so emit it from the shared `common` dir.
    generateFiles(
      tree,
      joinPathFragments(import.meta.dirname, 'files', 'common'),
      targetSourceDir,
      templateContext,
      { overwriteStrategy: OverwriteStrategy.KeepExisting },
    );
  }

  // Generate protocol-specific files. Each protocol's server entry point is
  // framework-specific (Strands yields a contextmanaged Agent; LangChain drives
  // a compiled create_agent graph), so it comes from a per-framework dir
  // `<protocol>-langchain` for LangChain, or `<protocol>` for Strands.
  const protocolLower = protocol.toLowerCase();
  const protocolTemplateDir =
    framework === 'langchain' ? `${protocolLower}-langchain` : protocolLower;
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', protocolTemplateDir),
    targetSourceDir,
    templateContext,
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );
  // The HTTP server's init.py (the FastAPI app + JsonStreamingResponse) is
  // framework-agnostic and the LangChain http main.py reuses it, so emit it
  // from the shared `http` dir. Emitted after the langchain main.py above so
  // KeepExisting preserves that main.py and only adds init.py (the shared dir's
  // own Strands main.py is skipped).
  if (protocolLower === 'http' && framework === 'langchain') {
    generateFiles(
      tree,
      joinPathFragments(import.meta.dirname, 'files', 'http'),
      targetSourceDir,
      templateContext,
      { overwriteStrategy: OverwriteStrategy.KeepExisting },
    );
  }

  addDependenciesToPyProjectToml(tree, project.root, [
    'aws-lambda-powertools',
    'aws-opentelemetry-distro',
    'bedrock-agentcore',
    'boto3',
    'fastapi',
    'mcp',
    ...(framework === 'langchain'
      ? // langchain pulls no Strands dependencies — the langchain model binding
        // (langchain, langchain-aws, langgraph) plus the per-protocol server
        // adapter: ag-ui-langgraph for AG-UI, a2a-sdk for A2A, nothing extra for
        // HTTP (FastAPI is added above for every agent).
        ([
          'langchain',
          'langchain-aws',
          'langgraph',
          ...(protocol === 'ag-ui'
            ? (['ag-ui-protocol', 'ag-ui-langgraph'] as const)
            : protocol === 'a2a'
              ? (['a2a-sdk'] as const)
              : ([] as const)),
        ] as const)
      : protocol === 'a2a'
        ? (['strands-agents[a2a]', 'strands-agents-tools'] as const)
        : protocol === 'ag-ui'
          ? ([
              'strands-agents',
              'strands-agents-tools',
              'ag-ui-protocol',
              'ag-ui-strands',
            ] as const)
          : (['strands-agents', 'strands-agents-tools'] as const)),
    'uvicorn',
  ]);
  addDependenciesToDependencyGroupInPyProjectToml(tree, project.root, 'dev', [
    'fastapi[standard]',
  ]);

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
    const fs = new FsCommands(tree);
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

  // TypeScript deps for the chat CLI, which runs standalone via tsx for every
  // protocol and resolves the deployed agent from AppConfig. `agent-chat-cli`
  // transitively bundles the protocol clients (@a2a-js/sdk, @ag-ui/client).
  addDependenciesToPackageJson(
    tree,
    {},
    withVersions([
      'agent-chat-cli',
      'tsx',
      '@types/node',
      '@aws-lambda-powertools/parameters',
      '@aws-sdk/client-appconfigdata',
      ...(auth === 'iam'
        ? (['aws4fetch', '@aws-sdk/credential-providers'] as const)
        : ([] as const)),
      ...(protocol === 'a2a' ? (['@a2a-js/sdk'] as const) : ([] as const)),
    ]),
  );

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
    {
      port: localDevPort,
      rc: agentNameClassName,
      auth,
      protocol,
      // The mcp / gateway connection generators dispatch on this field to pick
      // the Strands vs LangChain Layer-2 client + agent.py transform.
      framework,
    },
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
