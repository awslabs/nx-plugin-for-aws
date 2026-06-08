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
import type { PyAgentGatewayConnectionGeneratorSchema } from './schema';

const py = (pattern: string) => `language python\n${pattern}`;

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
  const gatewayComponent = options.targetComponent;

  if (!agentComponent || !gatewayComponent) {
    throw new Error(
      'Both sourceComponent and targetComponent must be provided for py#agent -> cedar#agentcore-gateway connections',
    );
  }

  if (gatewayComponent.protocol !== 'mcp') {
    throw new Error(
      `Gateway '${gatewayComponent.name}' has protocol='${gatewayComponent.protocol}'. Only MCP-protocol gateways are supported.`,
    );
  }
  if (gatewayComponent.auth !== 'iam') {
    throw new Error(
      `Gateway '${gatewayComponent.name}' uses auth='${gatewayComponent.auth}'. Only IAM-authenticated gateways are supported in v1.`,
    );
  }
  if (agentComponent.auth && agentComponent.auth !== 'iam') {
    throw new Error(
      `Agent '${agentComponent.name}' uses auth='${agentComponent.auth}'. Only IAM-authenticated agents can connect to IAM gateways.`,
    );
  }

  const gatewayClassName = gatewayComponent.rc as string;
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
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'agent-connection', 'app'),
    appDir,
    {
      gatewaySnakeCase,
      gatewayClassName,
      agentConnectionModuleName,
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
    await addGatewayToolsToAgent(tree, agentFilePath, clientVarName);
    await addGatewayClientToGetAgent(
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

  console.log('');
  console.log(
    `✔ Connected ${agentComponent.name} agent to ${gatewayClassName} gateway.`,
  );
  console.log('');
  console.log('Add to the stack that instantiates your agent + gateway:');
  console.log(
    `  ${gatewayClassName.charAt(0).toLowerCase()}${gatewayClassName.slice(1)}.grantInvokeAccess(agent);`,
  );
  console.log('');

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

const addGatewayToolsToAgent = async (
  tree: Tree,
  filePath: string,
  clientVarName: string,
): Promise<void> => {
  // Same shape mcp-connection uses: spread the gateway client's
  // list_tools_sync() into the existing tools array.
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

const addGatewayClientToGetAgent = async (
  tree: Tree,
  filePath: string,
  clientClassName: string,
  clientVarName: string,
): Promise<void> => {
  // Already wired? Nothing to do.
  if (await matchGritQL(tree, filePath, `\`${clientClassName}.create()\``)) {
    return;
  }

  // Existing `with (clients,):` block from a previous mcp/gateway connection
  // — extend it in place. This mirrors the pattern used by mcp-connection.
  const addedToWith = await applyGritQL(
    tree,
    filePath,
    py(`\`with ($items,): $body\` where {
  $items <: not contains \`${clientVarName}\`,
  $items += \`, ${clientVarName}\`
}`),
  );

  if (addedToWith) {
    // Insert `<var> = <Class>.create()` after the most recent `<var> = <_>.create()`.
    await applyGritQL(
      tree,
      filePath,
      py(`\`$var = $cls.create()\` as $stmt where {
  $program <: not contains \`${clientClassName}.create\`,
  $stmt += \`\n${clientVarName} = ${clientClassName}.create()\`
}`),
    );
    return;
  }

  // First connection — wrap the existing `def get_agent` body in a single
  // `with (<var>,):` block. The Gateway client (whether the deployed-mode
  // ``MCPClient`` or the local-mode ``AgentCoreGatewayLocalMultiplexClient``)
  // is a context manager, so this is the same pattern mcp-connection uses
  // and matches what the reviewer asked for.
  await applyGritQL(
    tree,
    filePath,
    py(`\`def get_agent($params):
    $body\` where {
  $body <: contains \`yield Agent($_)\`,
  $body <: not contains \`${clientClassName}.create\`
} => \`def get_agent($params):
    ${clientVarName} = ${clientClassName}.create()
    with (
        ${clientVarName},
    ):
        $body\``),
  );
};

export default pyAgentGatewayConnectionGenerator;
