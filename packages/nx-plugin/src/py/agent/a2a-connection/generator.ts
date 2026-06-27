/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  generateFiles,
  installPackagesTask,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import {
  type AgentFramework,
  addPythonCoreClient,
  addPythonReExport,
  ensurePythonAgentConnectionProject,
  getPythonAgentConnectionModuleName,
  getPythonAgentConnectionProject,
  getPythonAgentConnectionProjectDir,
  PY_CLIENT_NAMING,
  resolveAgentFramework,
} from '../../../utils/agent-connection/agent-connection';
import {
  addPythonDestructuredImport,
  applyGritQL,
  matchGritQL,
} from '../../../utils/ast';
import { formatFilesInSubtree } from '../../../utils/format';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import { snakeCase } from '../../../utils/names';
import {
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import {
  addDependenciesToPyProjectToml,
  addWorkspaceDependencyToPyProject,
} from '../../../utils/py';
import type { IPyDepVersion } from '../../../utils/versions';
import type { PyAgentA2aConnectionGeneratorSchema } from './schema';

/** Prefix a GritQL pattern with `language python` */
const py = (pattern: string) => `language python\n${pattern}`;

/** The module each framework imports the `tool` decorator from. */
const TOOL_IMPORT_MODULE: Record<AgentFramework, string> = {
  strands: 'strands',
  langchain: 'langchain_core.tools',
};

/** The GritQL pattern matching each framework's agent constructor. */
const AGENT_CONSTRUCTOR: Record<AgentFramework, string> = {
  strands: 'yield Agent($_)',
  langchain: 'create_agent($_)',
};

/**
 * The A2A transport dependency each framework's Layer-2 client needs. Strands
 * wraps strands' `A2AAgent` (strands-agents[a2a]); LangChain drives the a2a SDK
 * directly (a2a-sdk) and must not pull Strands in.
 */
const A2A_TRANSPORT_DEP: Record<AgentFramework, IPyDepVersion> = {
  strands: 'strands-agents[a2a]',
  langchain: 'a2a-sdk',
};

export const PY_AGENT_A2A_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const pyAgentA2aConnectionGenerator = async (
  tree: Tree,
  options: PyAgentA2aConnectionGeneratorSchema,
): Promise<GeneratorCallback> => {
  const sourceProject = readProjectConfigurationUnqualified(
    tree,
    options.sourceProject,
  );
  const targetProject = readProjectConfigurationUnqualified(
    tree,
    options.targetProject,
  );

  const agentComponent = options.sourceComponent;
  const targetAgentComponent = options.targetComponent;

  if (!agentComponent || !targetAgentComponent) {
    throw new Error(
      'Both sourceComponent and targetComponent must be provided for py#agent -> a2a connections',
    );
  }

  if ((targetAgentComponent.protocol ?? '').toLowerCase() !== 'a2a') {
    throw new Error(
      `Target agent '${targetAgentComponent.name}' uses the ${targetAgentComponent.protocol ?? 'http'} protocol — only A2A agents can be connected as tools.`,
    );
  }

  if (
    targetAgentComponent.auth &&
    targetAgentComponent.auth.toLowerCase() !== 'iam'
  ) {
    throw new Error(
      `A2A agent connection currently only supports IAM authentication, but '${targetAgentComponent.name}' uses '${targetAgentComponent.auth}' authentication.`,
    );
  }

  const targetAgentComponentName = targetAgentComponent.name ?? 'agent';
  const targetAgentClassName = targetAgentComponent.rc as string;
  const targetAgentSnakeCase = snakeCase(targetAgentClassName);
  const targetAgentPort = targetAgentComponent.port ?? 9000;

  // The source agent's framework drives everything that varies: the client
  // naming + app template (shared with the mcp/gateway generators via
  // PY_CLIENT_NAMING), the A2A transport dep (see A2A_TRANSPORT_DEP), and the
  // agent.py transform below. Each framework wraps its own A2A Layer-2 client
  // (Strands' A2AAgent vs an a2a-sdk-only client) over the shared,
  // framework-agnostic A2A client config. Keyed on the framework, not a
  // boolean, so a third framework stays additive.
  const framework = resolveAgentFramework(agentComponent.framework);
  const naming = PY_CLIENT_NAMING[framework];

  // 1. Ensure the shared Python agent-connection project exists + has the
  //    A2A core client (framework Layer-2) and its shared SigV4 auth helper.
  await ensurePythonAgentConnectionProject(tree);
  await addPythonCoreClient(tree, 'a2a', framework);

  const agentConnectionProjectDir = getPythonAgentConnectionProjectDir(tree);
  const agentConnectionModuleName = getPythonAgentConnectionModuleName(tree);

  // A2A client config + shared auth helper deps, plus the framework's A2A
  // transport dep (see A2A_TRANSPORT_DEP).
  addDependenciesToPyProjectToml(tree, agentConnectionProjectDir, [
    'boto3',
    'httpx',
    A2A_TRANSPORT_DEP[framework],
  ]);

  // 2. Generate the per-connection client into the shared agent-connection project
  const appDir = joinPathFragments(
    agentConnectionProjectDir,
    agentConnectionModuleName,
    'app',
  );
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', naming.appTemplateSubdir),
    appDir,
    {
      targetAgentSnakeCase,
      targetAgentClassName,
      targetAgentPort,
      agentConnectionModuleName,
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Ensure app/__init__.py exists
  const appInitPath = joinPathFragments(appDir, '__init__.py');
  if (!tree.exists(appInitPath)) {
    tree.write(appInitPath, '');
  }

  // Add re-export to module __init__.py
  const moduleInitPath = joinPathFragments(
    agentConnectionProjectDir,
    agentConnectionModuleName,
    '__init__.py',
  );
  await addPythonReExport(
    tree,
    moduleInitPath,
    `.app.${targetAgentSnakeCase}_client_${naming.clientModuleSuffix}`,
    `${targetAgentClassName}Client${naming.clientClassSuffix}`,
  );

  // 3. Transform agent.py to add the A2A client import + wrap it as a tool
  const agentSourceDir = joinPathFragments(
    sourceProject.root,
    agentComponent.path ?? 'src',
  );
  const agentFilePath = joinPathFragments(agentSourceDir, 'agent.py');

  if (tree.exists(agentFilePath)) {
    const clientClassName = `${targetAgentClassName}Client${naming.clientClassSuffix}`;
    const clientVarName = targetAgentSnakeCase;
    const toolName = `ask_${targetAgentSnakeCase}`;

    await addImportToAgentFile(
      tree,
      agentFilePath,
      agentConnectionModuleName,
      clientClassName,
      framework,
    );
    await addToolToAgent(tree, agentFilePath, toolName, framework);
    await addClientToolToGetAgent(
      tree,
      agentFilePath,
      clientClassName,
      clientVarName,
      toolName,
      targetAgentClassName,
      framework,
    );
  }

  // 4. Add workspace dependency from agent project to agent-connection project
  addWorkspaceDependencyToPyProject(
    tree,
    sourceProject,
    getPythonAgentConnectionProject(tree),
  );

  // 5. Set up serve-local target dependencies — chain onto the target agent
  const agentName = agentComponent.name ?? 'agent';
  const serveLocalTargetName = `${agentName}-serve-local`;
  const targetServeLocalTargetName = `${targetAgentComponentName}-serve-local`;

  if (sourceProject.targets?.[serveLocalTargetName]) {
    addDependencyToTargetIfNotPresent(sourceProject, serveLocalTargetName, {
      projects: [targetProject.name],
      target: targetServeLocalTargetName,
    });
    updateProjectConfiguration(tree, sourceProject.name, sourceProject);
  }

  await addGeneratorMetricsIfApplicable(tree, [
    PY_AGENT_A2A_CONNECTION_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

/**
 * Add imports to agent.py:
 *  - `tool` (from `strands`, or `langchain_core.tools` for LangChain agents)
 *  - the per-connection client class from the shared agent-connection module
 */
const addImportToAgentFile = async (
  tree: Tree,
  filePath: string,
  agentConnectionModuleName: string,
  clientClassName: string,
  framework: AgentFramework,
): Promise<void> => {
  await addPythonDestructuredImport(
    tree,
    filePath,
    ['tool'],
    TOOL_IMPORT_MODULE[framework],
  );
  await addPythonDestructuredImport(
    tree,
    filePath,
    [clientClassName],
    agentConnectionModuleName,
  );
};

/**
 * Add the A2A tool to the Agent's tools array using GritQL.
 *
 * Scoped to the framework's agent constructor so unrelated `tools=` keyword
 * arguments elsewhere in the file are not touched.
 */
const addToolToAgent = async (
  tree: Tree,
  filePath: string,
  toolName: string,
  framework: AgentFramework,
): Promise<void> => {
  const scope = AGENT_CONSTRUCTOR[framework];
  await applyGritQL(
    tree,
    filePath,
    py(`\`tools=$old\` where {
  $old <: within \`${scope}\`,
  $old <: not contains \`${toolName}\`,
  if ($old <: \`[]\`) {
    $old => \`[${toolName}]\`
  } else {
    $old <: \`[$items]\` where { $items += \`, ${toolName}\` }
  }
}`),
  );
};

/**
 * Wrap the get_agent body so the remote A2A client is created and exposed
 * as a `@tool`-decorated closure before constructing the Agent.
 *
 * Unlike MCP clients, A2A clients aren't context managers — we don't need
 * a `with` block around them. Creation + tool definition happen at the
 * top of the function body, anchored on the framework's agent constructor.
 */
const addClientToolToGetAgent = async (
  tree: Tree,
  filePath: string,
  clientClassName: string,
  clientVarName: string,
  toolName: string,
  targetAgentClassName: string,
  framework: AgentFramework,
): Promise<void> => {
  if (await matchGritQL(tree, filePath, py(`\`${clientClassName}.create\``))) {
    return;
  }

  // Both frameworks' tools are @tool-decorated callables (the decorator's
  // import differs, handled in addImportToAgentFile), defined inline in
  // get_agent. The client is directly callable, returning the remote's reply.
  const toolBlock = `${clientVarName} = ${clientClassName}.create()

    @tool
    def ${toolName}(prompt: str) -> str:
        """Delegate a question to the remote ${targetAgentClassName} A2A agent and return its reply."""
        return str(${clientVarName}(prompt))
`;

  // Prepend client creation + tool definition to the function body, anchored on
  // the framework's agent constructor. This works whether or not a prior MCP
  // block is present since we insert before any existing statements.
  const anchor = AGENT_CONSTRUCTOR[framework];
  await applyGritQL(
    tree,
    filePath,
    py(`\`def get_agent($params):
    $body\` where {
  $body <: contains \`${anchor}\`,
  $body <: not contains \`${clientClassName}.create\`
} => \`def get_agent($params):
    ${toolBlock}
    $body\``),
  );
};

export default pyAgentA2aConnectionGenerator;
