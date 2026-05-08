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
import { PyStrandsAgentMcpConnectionGeneratorSchema } from './schema';
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

export const PY_STRANDS_AGENT_MCP_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const pyStrandsAgentMcpConnectionGenerator = async (
  tree: Tree,
  options: PyStrandsAgentMcpConnectionGeneratorSchema,
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
  const mcpComponent = options.targetComponent;

  if (!agentComponent || !mcpComponent) {
    throw new Error(
      'Both sourceComponent and targetComponent must be provided for py#strands-agent -> mcp connections',
    );
  }

  if (mcpComponent.auth && mcpComponent.auth !== 'IAM') {
    throw new Error(
      `MCP server connection currently only supports IAM authentication, but '${mcpComponent.name}' uses '${mcpComponent.auth}' authentication.`,
    );
  }

  const mcpComponentName = mcpComponent.name ?? 'mcp-server';
  const mcpServerClassName = mcpComponent.rc as string;
  const mcpServerSnakeCase = snakeCase(mcpServerClassName);
  const mcpServerPort = mcpComponent.port ?? 8000;

  // 1. Ensure the shared Python agent-connection project exists + has the
  //    MCP core client and its shared SigV4 auth helper.
  await ensurePythonAgentConnectionProject(tree);
  addPythonCoreClient(tree, 'auth');
  addPythonCoreClient(tree, 'mcp');

  const agentConnectionProjectDir = getPythonAgentConnectionProjectDir(tree);
  const agentConnectionModuleName = getPythonAgentConnectionModuleName(tree);
  const agentConnectionPackageName = getPythonAgentConnectionPackageName(tree);

  // Python deps required by the MCP core client + shared auth helper.
  addDependenciesToPyProjectToml(tree, agentConnectionProjectDir, [
    'boto3',
    'httpx',
    'mcp',
    'strands-agents',
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
      mcpServerSnakeCase,
      mcpServerClassName,
      mcpServerPort,
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
    `.app.${mcpServerSnakeCase}_client`,
    `${mcpServerClassName}Client`,
  );

  // 3. Transform agent.py to add MCP client import and usage
  const agentSourceDir = joinPathFragments(
    sourceProject.root,
    agentComponent.path ?? 'src',
  );
  const agentFilePath = joinPathFragments(agentSourceDir, 'agent.py');

  if (tree.exists(agentFilePath)) {
    const clientClassName = `${mcpServerClassName}Client`;
    const clientVarName = mcpServerSnakeCase;

    await addImportToAgentFile(
      tree,
      agentFilePath,
      agentConnectionModuleName,
      clientClassName,
    );
    await addMcpToolsToAgent(tree, agentFilePath, clientVarName);
    await addMcpClientToGetAgent(
      tree,
      agentFilePath,
      clientClassName,
      clientVarName,
    );
  }

  // 4. Add workspace dependency from agent project to agent-connection project
  addWorkspaceDependencyToPyProject(
    tree,
    sourceProject.root,
    agentConnectionPackageName,
  );

  // 5. Set up serve-local target dependencies
  const agentName = agentComponent.name ?? 'agent';
  const serveLocalTargetName = `${agentName}-serve-local`;
  const mcpServeLocalTargetName = `${mcpComponentName}-serve-local`;

  if (sourceProject.targets?.[serveLocalTargetName]) {
    const target = sourceProject.targets[serveLocalTargetName];
    target.dependsOn = [
      ...(target.dependsOn ?? []),
      {
        projects: [targetProject.name],
        target: mcpServeLocalTargetName,
      },
    ];
    updateProjectConfiguration(tree, sourceProject.name, sourceProject);
  }

  await addGeneratorMetricsIfApplicable(tree, [
    PY_STRANDS_AGENT_MCP_CONNECTION_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

/**
 * Add an import for the MCP client class to agent.py.
 *
 * Delegates to the shared `addPythonDestructuredImport` helper which either
 * appends to an existing `from <module> import ...` line or prepends a new
 * import statement (ruff sorts imports on the next format pass).
 */
const addImportToAgentFile = async (
  tree: Tree,
  filePath: string,
  agentConnectionModuleName: string,
  clientClassName: string,
): Promise<void> => {
  await addPythonDestructuredImport(
    tree,
    filePath,
    [clientClassName],
    agentConnectionModuleName,
  );
};

/**
 * Add MCP tools to the Agent's tools array using GritQL.
 * Appends `*<clientVarName>.list_tools_sync()` to the tools list.
 * Handles both empty and non-empty arrays using if/else.
 */
const addMcpToolsToAgent = async (
  tree: Tree,
  filePath: string,
  clientVarName: string,
): Promise<void> => {
  if (
    await matchGritQL(tree, filePath, `\`${clientVarName}.list_tools_sync()\``)
  ) {
    return;
  }

  await applyGritQL(
    tree,
    filePath,
    py(`\`tools=$old\` where {
  $old <: not contains \`${clientVarName}\`,
  if ($old <: \`[]\`) {
    $old => \`[*${clientVarName}.list_tools_sync()]\`
  } else {
    $old <: \`[$items]\` where { $items += \`, *${clientVarName}.list_tools_sync()\` }
  }
}`),
  );
};

/**
 * Add MCP client creation and with-block wrapping to the get_agent function
 * using GritQL transforms.
 *
 * First connection: Rewrites `def get_agent` to wrap $body in a with block.
 * Subsequent connections: Uses += to add to existing with items and creation lines.
 */
const addMcpClientToGetAgent = async (
  tree: Tree,
  filePath: string,
  clientClassName: string,
  clientVarName: string,
): Promise<void> => {
  if (await matchGritQL(tree, filePath, `\`${clientClassName}.create($_)\``)) {
    return;
  }

  // Try the "add to existing with block" pattern first.
  // If it succeeds, there was already a with block from a previous connection.
  const addedToWith = await applyGritQL(
    tree,
    filePath,
    py(`\`with ($items,): $body\` where {
  $items <: not contains \`${clientVarName}\`,
  $items += \`, ${clientVarName}\`
}`),
  );

  if (addedToWith) {
    // Subsequent connection — also add creation line after the existing one
    await applyGritQL(
      tree,
      filePath,
      py(`\`$var = $cls.create(session_id=session_id)\` as $stmt where {
  $program <: not contains \`${clientClassName}.create\`,
  $stmt += \`\n${clientVarName} = ${clientClassName}.create(session_id=session_id)\`
}`),
    );
    return;
  }

  // First connection — rewrite the function body to include client creation
  // and wrap $body in a with block. GritQL handles indentation correctly
  // when the replacement is structured as a proper Python function body.
  await applyGritQL(
    tree,
    filePath,
    py(`\`def get_agent($params):
    $body\` where {
  $body <: contains \`yield Agent($_)\`,
  $body <: not contains \`with ($_, ): $_\`
} => \`def get_agent($params):
    ${clientVarName} = ${clientClassName}.create(session_id=session_id)
    with (
        ${clientVarName},
    ):
        $body\``),
  );
};

export default pyStrandsAgentMcpConnectionGenerator;
