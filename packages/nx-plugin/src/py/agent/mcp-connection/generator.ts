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
  PY_MCP_FAMILY_CONNECTIONS,
  resolveAgentFramework,
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

  // The source agent's framework selects the client shape, dependencies and the
  // agent.py transform — see PY_MCP_FAMILY_CONNECTIONS (keyed by framework, not a
  // boolean, so a third framework is an additive entry there).
  const framework = resolveAgentFramework(agentComponent.framework);
  const connection = PY_MCP_FAMILY_CONNECTIONS[framework];

  // 1. Ensure the shared Python agent-connection project exists + has the
  //    MCP core client (framework Layer-2) and its shared SigV4 auth helper.
  await ensurePythonAgentConnectionProject(tree);
  await addPythonCoreClient(tree, 'mcp', framework);

  const agentConnectionProjectDir = getPythonAgentConnectionProjectDir(tree);
  const agentConnectionModuleName = getPythonAgentConnectionModuleName(tree);
  const agentConnectionPackageName = getPythonAgentConnectionPackageName(tree);

  // Shared MCP transport + signed httpx auth deps, plus whatever extra deps the
  // framework's MCP client needs (e.g. langchain-mcp-adapters for LangChain).
  addDependenciesToPyProjectToml(tree, agentConnectionProjectDir, [
    'boto3',
    'httpx',
    'mcp',
    ...connection.deps,
  ]);

  // 2. Generate the per-connection client into the shared agent-connection project
  const appDir = joinPathFragments(
    agentConnectionProjectDir,
    agentConnectionModuleName,
    'app',
  );
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', connection.appTemplateSubdir),
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
    `.app.${mcpServerSnakeCase}_client_${connection.clientModuleSuffix}`,
    `${mcpServerClassName}Client${connection.clientClassSuffix}`,
  );

  // 3. Transform agent.py to add MCP client import and usage
  const agentSourceDir = joinPathFragments(
    sourceProject.root,
    agentComponent.path ?? 'src',
  );
  const agentFilePath = joinPathFragments(agentSourceDir, 'agent.py');

  if (tree.exists(agentFilePath)) {
    const clientClassName = `${mcpServerClassName}Client${connection.clientClassSuffix}`;
    const clientVarName = mcpServerSnakeCase;

    await addPythonDestructuredImport(
      tree,
      agentFilePath,
      [clientClassName],
      agentConnectionModuleName,
    );
    await connection.wireClientIntoAgent(
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
