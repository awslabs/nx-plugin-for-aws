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
  addPythonCoreClient,
  addPythonReExport,
  ensurePythonAgentConnectionProject,
  getPythonAgentConnectionModuleName,
  getPythonAgentConnectionPackageName,
  getPythonAgentConnectionProjectDir,
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
import type { PyAgentA2aConnectionGeneratorSchema } from './schema';

/** Prefix a GritQL pattern with `language python` */
const py = (pattern: string) => `language python\n${pattern}`;

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

  // The transform applied to agent.py depends on the source agent's framework.
  // Both register the remote A2A agent as a tool, but Strands uses `yield
  // Agent(...)` + the strands `@tool`, while LangChain uses `create_agent(...)`
  // + the langchain_core `@tool`. The outbound A2A client itself is
  // framework-agnostic (A2AAgent carries no model), so both reuse it.
  const framework =
    agentComponent.framework === 'langchain' ? 'langchain' : 'strands';
  const isLangchain = framework === 'langchain';

  // 1. Ensure the shared Python agent-connection project exists + has the
  //    A2A core client and its shared SigV4 auth helper.
  await ensurePythonAgentConnectionProject(tree);
  await addPythonCoreClient(tree, 'a2a');

  const agentConnectionProjectDir = getPythonAgentConnectionProjectDir(tree);
  const agentConnectionModuleName = getPythonAgentConnectionModuleName(tree);
  const agentConnectionPackageName = getPythonAgentConnectionPackageName(tree);

  // Layer 0/1 deps for the A2A client config + shared auth helper, plus the
  // Strands A2A extra the A2A client needs (the base strands-agents dependency
  // is added by addPythonCoreClient). The A2A client wraps the Strands
  // `A2AAgent` purely as an A2A transport (it carries no model), so a LangChain
  // source agent that delegates to an A2A agent also pulls in strands-agents[a2a]
  // for that transport. The agent's own framework is unaffected — only the
  // connection's outbound client uses it.
  addDependenciesToPyProjectToml(tree, agentConnectionProjectDir, [
    'boto3',
    'httpx',
    'strands-agents[a2a]',
  ]);

  // 2. Generate the per-connection client into the shared agent-connection project
  const appDir = joinPathFragments(
    agentConnectionProjectDir,
    agentConnectionModuleName,
    'app',
  );
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'agent-connection', 'app'),
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
    `.app.${targetAgentSnakeCase}_client_strands`,
    `${targetAgentClassName}ClientStrands`,
  );

  // 3. Transform agent.py to add the A2A client import + wrap it as a tool
  const agentSourceDir = joinPathFragments(
    sourceProject.root,
    agentComponent.path ?? 'src',
  );
  const agentFilePath = joinPathFragments(agentSourceDir, 'agent.py');

  if (tree.exists(agentFilePath)) {
    const clientClassName = `${targetAgentClassName}ClientStrands`;
    const clientVarName = targetAgentSnakeCase;
    const toolName = `ask_${targetAgentSnakeCase}`;

    await addImportToAgentFile(
      tree,
      agentFilePath,
      agentConnectionModuleName,
      clientClassName,
      isLangchain,
    );
    await addToolToAgent(tree, agentFilePath, toolName, isLangchain);
    await addClientToolToGetAgent(
      tree,
      agentFilePath,
      clientClassName,
      clientVarName,
      toolName,
      targetAgentClassName,
      isLangchain,
    );
  }

  // 4. Add workspace dependency from agent project to agent-connection project
  addWorkspaceDependencyToPyProject(
    tree,
    sourceProject.root,
    agentConnectionPackageName,
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
  isLangchain: boolean,
): Promise<void> => {
  await addPythonDestructuredImport(
    tree,
    filePath,
    ['tool'],
    isLangchain ? 'langchain_core.tools' : 'strands',
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
 * Scoped to the agent constructor (`yield Agent($_)` for Strands,
 * `create_agent($_)` for LangChain) so unrelated `tools=` keyword arguments
 * elsewhere in the file are not touched.
 */
const addToolToAgent = async (
  tree: Tree,
  filePath: string,
  toolName: string,
  isLangchain: boolean,
): Promise<void> => {
  const scope = isLangchain ? 'create_agent($_)' : 'yield Agent($_)';
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
 * top of the function body, anchored on the agent constructor (`yield Agent`
 * for Strands, `create_agent` for LangChain).
 */
const addClientToolToGetAgent = async (
  tree: Tree,
  filePath: string,
  clientClassName: string,
  clientVarName: string,
  toolName: string,
  targetAgentClassName: string,
  isLangchain: boolean,
): Promise<void> => {
  if (await matchGritQL(tree, filePath, py(`\`${clientClassName}.create\``))) {
    return;
  }

  // The tool function we'll insert. Both Strands and LangChain tools are
  // @tool-decorated callables (the decorator's import differs, handled in
  // addImportToAgentFile), so we define them inline in get_agent. A2AAgent is
  // directly callable (syncs over invoke_async internally).
  const toolBlock = `${clientVarName} = ${clientClassName}.create()

    @tool
    def ${toolName}(prompt: str) -> str:
        """Delegate a question to the remote ${targetAgentClassName} A2A agent and return its reply."""
        return str(${clientVarName}(prompt))
`;

  // Prepend client creation + tool definition to the function body, anchored on
  // the agent constructor (`yield Agent` for Strands, `create_agent` for
  // LangChain). This works whether or not a prior MCP block is present since we
  // insert before any existing statements.
  const anchor = isLangchain ? 'create_agent($_)' : 'yield Agent($_)';
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
