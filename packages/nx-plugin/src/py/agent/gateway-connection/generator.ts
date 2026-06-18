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
import { readAgentCoreGatewayMetadata } from '../../../agentcore-gateway/generator';
import {
  addPythonClientToAgent,
  addPythonCoreClient,
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
import type { PyAgentGatewayConnectionGeneratorSchema } from './schema';

export const PY_AGENT_GATEWAY_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const pyAgentGatewayConnectionGenerator = async (
  tree: Tree,
  options: PyAgentGatewayConnectionGeneratorSchema,
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
  if (!agentComponent) {
    throw new Error(
      'sourceComponent must be provided for py#agent -> agentcore-gateway connections',
    );
  }

  // The gateway client returns a Strands MCPClient consumed via list_tools_sync().
  // A LangChain agent would need a langchain-mcp-adapters gateway client and a
  // different agent.py transform, which is not yet implemented — fail fast
  // rather than silently emit a broken agent.py.
  if ((agentComponent.framework ?? 'strands') === 'langchain') {
    throw new Error(
      `Agent '${agentComponent.name}' uses the 'langchain' framework, which is not yet supported for AgentCore Gateway connections. Use a direct MCP server connection instead, or use a Strands agent.`,
    );
  }

  const gateway = readAgentCoreGatewayMetadata(targetProject);

  if (gateway.protocol !== 'mcp') {
    throw new Error(
      `Gateway '${gateway.name}' has protocol='${gateway.protocol}'. Only MCP-protocol gateways are supported.`,
    );
  }
  if (gateway.auth !== 'iam') {
    throw new Error(
      `Gateway '${gateway.name}' uses auth='${gateway.auth}'. Only IAM-authenticated gateways are supported in v1.`,
    );
  }
  if (agentComponent.auth && agentComponent.auth !== 'iam') {
    throw new Error(
      `Agent '${agentComponent.name}' uses auth='${agentComponent.auth}'. Only IAM-authenticated agents can connect to IAM gateways.`,
    );
  }

  const gatewayClassName = gateway.rc;
  const gatewaySnakeCase = snakeCase(gatewayClassName);
  const gatewayKebabCase = gatewaySnakeCase.replace(/_/g, '-');
  const gatewayServeTargetName = `${gatewayKebabCase}-serve`;
  const gatewayServeLocalTargetName = `${gatewayKebabCase}-serve-local`;

  await ensurePythonAgentConnectionProject(tree);
  addPythonCoreClient(tree, 'auth');
  addPythonCoreClient(tree, 'gateway');

  const agentConnectionProjectDir = getPythonAgentConnectionProjectDir(tree);
  const agentConnectionModuleName = getPythonAgentConnectionModuleName(tree);
  const agentConnectionPackageName = getPythonAgentConnectionPackageName(tree);

  addDependenciesToPyProjectToml(tree, agentConnectionProjectDir, [
    'boto3',
    'httpx',
    'mcp',
    'strands-agents',
  ]);

  const appDir = joinPathFragments(
    agentConnectionProjectDir,
    agentConnectionModuleName,
    'app',
  );
  // Local mode points at the gateway project's local gateway port.
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'agent-connection', 'app'),
    appDir,
    {
      gatewaySnakeCase,
      gatewayClassName,
      agentConnectionModuleName,
      gatewayPort: gateway.port,
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  const appInitPath = joinPathFragments(appDir, '__init__.py');
  if (!tree.exists(appInitPath)) {
    tree.write(appInitPath, '');
  }

  const moduleInitPath = joinPathFragments(
    agentConnectionProjectDir,
    agentConnectionModuleName,
    '__init__.py',
  );
  await addPythonReExport(
    tree,
    moduleInitPath,
    `.app.${gatewaySnakeCase}_client`,
    `${gatewayClassName}Client`,
  );

  const agentSourceDir = joinPathFragments(
    sourceProject.root,
    agentComponent.path ?? 'src',
  );
  const agentFilePath = joinPathFragments(agentSourceDir, 'agent.py');

  if (tree.exists(agentFilePath)) {
    const clientClassName = `${gatewayClassName}Client`;
    const clientVarName = gatewaySnakeCase;

    await addPythonDestructuredImport(
      tree,
      agentFilePath,
      [clientClassName],
      agentConnectionModuleName,
    );
    await addPythonClientToAgent(
      tree,
      agentFilePath,
      clientClassName,
      clientVarName,
    );
  }

  addWorkspaceDependencyToPyProject(
    tree,
    sourceProject.root,
    agentConnectionPackageName,
  );

  const agentName = agentComponent.name ?? 'agent';
  const serveTargetName = `${agentName}-serve`;
  const serveLocalTargetName = `${agentName}-serve-local`;
  let projectConfigChanged = false;
  if (sourceProject.targets?.[serveTargetName]) {
    addDependencyToTargetIfNotPresent(sourceProject, serveTargetName, {
      projects: [targetProject.name],
      target: gatewayServeTargetName,
    });
    projectConfigChanged = true;
  }
  if (sourceProject.targets?.[serveLocalTargetName]) {
    addDependencyToTargetIfNotPresent(sourceProject, serveLocalTargetName, {
      projects: [targetProject.name],
      target: gatewayServeLocalTargetName,
    });
    projectConfigChanged = true;
  }
  if (projectConfigChanged) {
    updateProjectConfiguration(tree, sourceProject.name, sourceProject);
  }

  await addGeneratorMetricsIfApplicable(tree, [
    PY_AGENT_GATEWAY_CONNECTION_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

export default pyAgentGatewayConnectionGenerator;
