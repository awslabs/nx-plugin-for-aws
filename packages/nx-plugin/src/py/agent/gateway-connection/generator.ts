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
  addPythonCoreClient,
  addPythonReExport,
  ensurePythonAgentConnectionProject,
  getPythonAgentConnectionModuleName,
  getPythonAgentConnectionProject,
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
  const gatewayDevTargetName = `${gatewayKebabCase}-dev`;

  // The source agent's framework selects the client shape, dependencies and the
  // agent.py transform — see PY_MCP_FAMILY_CONNECTIONS (keyed by framework, not a
  // boolean, so a third framework is an additive entry there). A Gateway exposes
  // its tools over MCP, so it reuses the same wiring as an MCP server connection.
  const framework = resolveAgentFramework(agentComponent.framework);
  const connection = PY_MCP_FAMILY_CONNECTIONS[framework];

  await ensurePythonAgentConnectionProject(tree);
  await addPythonCoreClient(tree, 'gateway', framework);

  const agentConnectionProjectDir = getPythonAgentConnectionProjectDir(tree);
  const agentConnectionModuleName = getPythonAgentConnectionModuleName(tree);

  // Shared MCP transport + signed httpx auth deps, plus whatever extra deps the
  // framework's MCP client needs (e.g. langchain-mcp-adapters for LangChain).
  addDependenciesToPyProjectToml(tree, agentConnectionProjectDir, [
    'boto3',
    'httpx',
    'mcp',
    ...connection.deps,
  ]);

  const appDir = joinPathFragments(
    agentConnectionProjectDir,
    agentConnectionModuleName,
    'app',
  );
  // Local mode points at the gateway project's local gateway port.
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', connection.appTemplateSubdir),
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
    `.app.${gatewaySnakeCase}_client_${connection.clientModuleSuffix}`,
    `${gatewayClassName}Client${connection.clientClassSuffix}`,
  );

  const agentSourceDir = joinPathFragments(
    sourceProject.root,
    agentComponent.path ?? 'src',
  );
  const agentFilePath = joinPathFragments(agentSourceDir, 'agent.py');

  if (tree.exists(agentFilePath)) {
    const clientClassName = `${gatewayClassName}Client${connection.clientClassSuffix}`;
    const clientVarName = gatewaySnakeCase;

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

  addWorkspaceDependencyToPyProject(
    tree,
    sourceProject,
    getPythonAgentConnectionProject(tree),
  );

  const agentName = agentComponent.name ?? 'agent';
  const serveTargetName = `${agentName}-serve`;
  const devTargetName = `${agentName}-dev`;
  let projectConfigChanged = false;
  if (sourceProject.targets?.[serveTargetName]) {
    addDependencyToTargetIfNotPresent(sourceProject, serveTargetName, {
      projects: [targetProject.name],
      target: gatewayServeTargetName,
    });
    projectConfigChanged = true;
  }
  if (sourceProject.targets?.[devTargetName]) {
    addDependencyToTargetIfNotPresent(sourceProject, devTargetName, {
      projects: [targetProject.name],
      target: gatewayDevTargetName,
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
