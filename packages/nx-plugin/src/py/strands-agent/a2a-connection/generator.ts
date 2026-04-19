/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  GeneratorCallback,
  OverwriteStrategy,
  Tree,
  generateFiles,
  installPackagesTask,
  joinPathFragments,
  updateProjectConfiguration,
} from '@nx/devkit';
import { PyStrandsAgentA2aConnectionGeneratorSchema } from './schema';
import {
  NxGeneratorInfo,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import { formatFilesInSubtree } from '../../../utils/format';
import { snakeCase } from '../../../utils/names';
import {
  addDependenciesToPyProjectToml,
  addWorkspaceDependencyToPyProject,
} from '../../../utils/py';
import {
  ensurePythonAgentConnectionProject,
  addPythonCoreClient,
  getPythonAgentConnectionProjectDir,
  getPythonAgentConnectionModuleName,
  getPythonAgentConnectionPackageName,
  addPythonReExport,
} from '../../../utils/agent-connection/agent-connection';
import {
  addPythonDestructuredImport,
  applyGritQL,
  matchGritQL,
} from '../../../utils/ast';

/** Prefix a GritQL pattern with `language python` */
const py = (pattern: string) => `language python\n${pattern}`;

export const PY_STRANDS_AGENT_A2A_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const pyStrandsAgentA2aConnectionGenerator = async (
  tree: Tree,
  options: PyStrandsAgentA2aConnectionGeneratorSchema,
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
      'Both sourceComponent and targetComponent must be provided for py#strands-agent -> a2a connections',
    );
  }

  if (targetAgentComponent.protocol !== 'A2A') {
    throw new Error(
      `Target agent '${targetAgentComponent.name}' uses the ${targetAgentComponent.protocol ?? 'HTTP'} protocol — only A2A agents can be connected as tools.`,
    );
  }

  if (targetAgentComponent.auth && targetAgentComponent.auth !== 'IAM') {
    throw new Error(
      `A2A agent connection currently only supports IAM authentication, but '${targetAgentComponent.name}' uses '${targetAgentComponent.auth}' authentication.`,
    );
  }

  const targetAgentComponentName = targetAgentComponent.name ?? 'agent';
  const targetAgentClassName = targetAgentComponent.rc as string;
  const targetAgentSnakeCase = snakeCase(targetAgentClassName);
  const targetAgentPort = targetAgentComponent.port ?? 9000;

  // 1. Ensure the shared Python agent-connection project exists + has the
  //    A2A core client and its shared SigV4 auth helper.
  await ensurePythonAgentConnectionProject(tree);
  addPythonCoreClient(tree, 'auth');
  addPythonCoreClient(tree, 'a2a');

  const agentConnectionProjectDir = getPythonAgentConnectionProjectDir(tree);
  const agentConnectionModuleName = getPythonAgentConnectionModuleName(tree);
  const agentConnectionPackageName = getPythonAgentConnectionPackageName(tree);

  // Python deps required by the A2A core client + shared auth helper.
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
    `.app.${targetAgentSnakeCase}_client`,
    `${targetAgentClassName}Client`,
  );

  // 3. Transform agent.py to add the A2A client import + wrap it as a tool
  const agentSourceDir = joinPathFragments(
    sourceProject.root,
    agentComponent.path ?? 'src',
  );
  const agentFilePath = joinPathFragments(agentSourceDir, 'agent.py');

  if (tree.exists(agentFilePath)) {
    const clientClassName = `${targetAgentClassName}Client`;
    const clientVarName = targetAgentSnakeCase;
    const toolName = `ask_${targetAgentSnakeCase}`;

    await addImportToAgentFile(
      tree,
      agentFilePath,
      agentConnectionModuleName,
      clientClassName,
    );
    await addToolToAgent(tree, agentFilePath, toolName);
    await addClientToolToGetAgent(
      tree,
      agentFilePath,
      clientClassName,
      clientVarName,
      toolName,
      targetAgentClassName,
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
    const target = sourceProject.targets[serveLocalTargetName];
    target.dependsOn = [
      ...(target.dependsOn ?? []),
      {
        projects: [targetProject.name],
        target: targetServeLocalTargetName,
      },
    ];
    updateProjectConfiguration(tree, sourceProject.name, sourceProject);
  }

  await addGeneratorMetricsIfApplicable(tree, [
    PY_STRANDS_AGENT_A2A_CONNECTION_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

/**
 * Add imports to agent.py:
 *  - `tool` from `strands`
 *  - the per-connection client class from the shared agent-connection module
 */
const addImportToAgentFile = async (
  tree: Tree,
  filePath: string,
  agentConnectionModuleName: string,
  clientClassName: string,
): Promise<void> => {
  await addPythonDestructuredImport(tree, filePath, ['tool'], 'strands');
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
 * Scoped via `$old <: within \`yield Agent($_)\`` so unrelated `tools=`
 * keyword arguments elsewhere in the file are not touched.
 */
const addToolToAgent = async (
  tree: Tree,
  filePath: string,
  toolName: string,
): Promise<void> => {
  await applyGritQL(
    tree,
    filePath,
    py(`\`tools=$old\` where {
  $old <: within \`yield Agent($_)\`,
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
 * as a `@tool`-decorated closure before yielding the Agent.
 *
 * Unlike MCP clients, A2A clients aren't context managers — we don't need
 * a `with` block around them. Creation + tool definition happen at the
 * top of the function body.
 */
const addClientToolToGetAgent = async (
  tree: Tree,
  filePath: string,
  clientClassName: string,
  clientVarName: string,
  toolName: string,
  targetAgentClassName: string,
): Promise<void> => {
  if (await matchGritQL(tree, filePath, `\`${clientClassName}.create\``)) {
    return;
  }

  // The tool function we'll insert. Strands tools in Python are just
  // @tool-decorated callables, so we define them inline in get_agent.
  // A2AAgent is directly callable (syncs over invoke_async internally).
  const toolBlock = `${clientVarName} = ${clientClassName}.create(session_id=session_id)

    @tool
    def ${toolName}(prompt: str) -> str:
        """Delegate a question to the remote ${targetAgentClassName} A2A agent and return its reply."""
        return str(${clientVarName}(prompt))
`;

  // Prepend client creation + tool definition to the function body.
  // This works whether or not a prior MCP `with` block is present since we
  // insert before any existing statements.
  await applyGritQL(
    tree,
    filePath,
    py(`\`def get_agent($params):
    $body\` where {
  $body <: contains \`yield Agent($_)\`,
  $body <: not contains \`${clientClassName}.create\`
} => \`def get_agent($params):
    ${toolBlock}
    $body\``),
  );
};

export default pyStrandsAgentA2aConnectionGenerator;
