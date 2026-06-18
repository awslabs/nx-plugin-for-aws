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
  addPythonClientToAgent,
  addPythonCoreClient,
  addPythonLangchainClientToAgent,
  addPythonReExport,
  ensurePythonAgentConnectionProject,
  getPythonAgentConnectionModuleName,
  getPythonAgentConnectionPackageName,
  getPythonAgentConnectionProjectDir,
} from '../../../utils/agent-connection/agent-connection';
import { addPythonDestructuredImport } from '../../../utils/ast';
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
import type { PyAgentMcpConnectionGeneratorSchema } from './schema';

export const PY_AGENT_MCP_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const pyAgentMcpConnectionGenerator = async (
  tree: Tree,
  options: PyAgentMcpConnectionGeneratorSchema,
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
      'Both sourceComponent and targetComponent must be provided for py#agent -> mcp connections',
    );
  }

  if (mcpComponent.auth && mcpComponent.auth.toLowerCase() !== 'iam') {
    throw new Error(
      `MCP server connection currently only supports IAM authentication, but '${mcpComponent.name}' uses '${mcpComponent.auth}' authentication.`,
    );
  }

  const mcpComponentName = mcpComponent.name ?? 'mcp-server';
  const mcpServerClassName = mcpComponent.rc as string;
  const mcpServerSnakeCase = snakeCase(mcpServerClassName);
  const mcpServerPort = mcpComponent.port ?? 8000;

  // The transform applied to agent.py depends on the source agent's framework:
  // Strands enters a context-managed MCPClient and spreads list_tools_sync();
  // LangChain loads BaseTools and spreads them into create_agent(...).
  const framework = agentComponent.framework ?? 'strands';
  const isLangchain = framework === 'langchain';

  // 1. Ensure the shared Python agent-connection project exists + has the
  //    MCP core client and its shared SigV4 auth helper.
  await ensurePythonAgentConnectionProject(tree);
  addPythonCoreClient(tree, 'auth');
  addPythonCoreClient(tree, isLangchain ? 'mcp-langchain' : 'mcp');

  const agentConnectionProjectDir = getPythonAgentConnectionProjectDir(tree);
  const agentConnectionModuleName = getPythonAgentConnectionModuleName(tree);
  const agentConnectionPackageName = getPythonAgentConnectionPackageName(tree);

  // Python deps required by the MCP core client + shared auth helper. The
  // Strands client uses strands MCPClient; the LangChain client uses
  // langchain-mcp-adapters and must not pull Strands in.
  addDependenciesToPyProjectToml(tree, agentConnectionProjectDir, [
    'boto3',
    'httpx',
    'mcp',
    ...(isLangchain
      ? (['langchain-mcp-adapters'] as const)
      : (['strands-agents'] as const)),
  ]);

  // 2. Generate the per-connection client into the shared agent-connection project
  const appDir = joinPathFragments(
    agentConnectionProjectDir,
    agentConnectionModuleName,
    'app',
  );
  generateFiles(
    tree,
    isLangchain
      ? joinPathFragments(
          __dirname,
          'files',
          'langchain',
          'agent-connection',
          'app',
        )
      : joinPathFragments(__dirname, 'files', 'agent-connection', 'app'),
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

    await addPythonDestructuredImport(
      tree,
      agentFilePath,
      [clientClassName],
      agentConnectionModuleName,
    );
    if (isLangchain) {
      await addPythonLangchainClientToAgent(
        tree,
        agentFilePath,
        clientClassName,
        clientVarName,
      );
    } else {
      await addPythonClientToAgent(
        tree,
        agentFilePath,
        clientClassName,
        clientVarName,
      );
    }
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
    addDependencyToTargetIfNotPresent(sourceProject, serveLocalTargetName, {
      projects: [targetProject.name],
      target: mcpServeLocalTargetName,
    });
    updateProjectConfiguration(tree, sourceProject.name, sourceProject);
  }

  await addGeneratorMetricsIfApplicable(tree, [
    PY_AGENT_MCP_CONNECTION_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

export default pyAgentMcpConnectionGenerator;
