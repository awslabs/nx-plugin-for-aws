/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  type GeneratorCallback,
  generateFiles,
  installPackagesTask,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import {
  AGENT_CONNECTION_PROJECT_DIR,
  addTypeScriptCoreClient,
  ensureTypeScriptAgentConnectionProject,
} from '../../../utils/agent-connection/agent-connection';
import {
  addDestructuredImport,
  addStarExport,
  applyGritQL,
} from '../../../utils/ast';
import { formatFilesInSubtree } from '../../../utils/format';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import { kebabCase } from '../../../utils/names';
import { getNpmScope } from '../../../utils/npm-scope';
import {
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import { withVersions } from '../../../utils/versions';
import type { TsAgentGatewayConnectionGeneratorSchema } from './schema';

export const TS_AGENT_GATEWAY_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const tsAgentGatewayConnectionGenerator = async (
  tree: Tree,
  options: TsAgentGatewayConnectionGeneratorSchema,
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
      'Both sourceComponent and targetComponent must be provided for ts#agent -> cedar#agentcore-gateway connections',
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
  const gatewayKebabCase = kebabCase(gatewayClassName);
  const gatewayServeTargetName = `${gatewayKebabCase}-serve`;
  const gatewayServeLocalTargetName = `${gatewayKebabCase}-serve-local`;

  const npmScope = getNpmScope(tree);

  // 1. Ensure the shared agent-connection project exists + has the gateway
  //    core client templates (SigV4 MCP client + local multiplex client).
  await ensureTypeScriptAgentConnectionProject(tree);
  addTypeScriptCoreClient(tree, 'gateway');

  // 2. Generate the per-connection <Gateway>Client into app/
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'agent-connection', 'app'),
    joinPathFragments(AGENT_CONNECTION_PROJECT_DIR, 'src', 'app'),
    {
      gatewayKebabCase,
      gatewayClassName,
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Re-export from the agent-connection index
  await addStarExport(
    tree,
    joinPathFragments(AGENT_CONNECTION_PROJECT_DIR, 'src', 'index.ts'),
    `./app/${gatewayKebabCase}-client.js`,
  );

  // 3. AST-transform agent.ts to add the gateway client to the agent's tools.
  //    `Agent.tools` accepts `(Tool | McpClient | Agent | ToolList)[]`, so
  //    we can pass either a single McpClient (deployed) or an array of them
  //    (local multiplex) — the client method returns `McpClient | McpClient[]`.
  const agentSourceDir = joinPathFragments(
    sourceProject.root,
    agentComponent.path ?? 'src',
  );
  const agentFilePath = joinPathFragments(agentSourceDir, 'agent.ts');

  if (tree.exists(agentFilePath)) {
    const clientClassName = `${gatewayClassName}Client`;
    const clientVarName =
      gatewayClassName.charAt(0).toLowerCase() + gatewayClassName.slice(1);

    await addDestructuredImport(
      tree,
      agentFilePath,
      [clientClassName],
      `:${npmScope}/agent-connection`,
    );

    const clientCreationStmt = `const ${clientVarName} = await ${clientClassName}.create();`;

    // Wrap / prepend client creation inside the arrow function that builds
    // the Agent — same pattern as mcp-connection / a2a-connection.
    await applyGritQL(
      tree,
      agentFilePath,
      `or { \`async ($p) => new Agent($args)\` => raw\`async ($p) => {
  ${clientCreationStmt}
  return new Agent($args);
}\` where { $program <: not contains \`${clientClassName}.create\` }, \`async ($p) => { $body }\` => raw\`async ($p) => {
  ${clientCreationStmt}
  $body
}\` where { $body <: contains \`new Agent($_)\`, $program <: not contains \`${clientClassName}.create\` } }`,
    );

    // Prepend the gateway client to the tools array
    await applyGritQL(
      tree,
      agentFilePath,
      `\`tools: [$items]\` => \`tools: [${clientVarName}, $items]\` where { $items <: within \`new Agent($_)\`, $items <: not contains \`${clientVarName}\` }`,
    );
  }

  // 4. Wire serve-local chain — agent's serve-local depends on gateway's
  //    aggregator target, which transitively starts each attached MCP server.
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

  // 5. Dependencies
  addDependenciesToPackageJson(
    tree,
    withVersions([
      '@modelcontextprotocol/sdk',
      '@strands-agents/sdk',
      '@aws-lambda-powertools/parameters',
      '@aws-sdk/client-appconfigdata',
      'aws4fetch',
      '@aws-sdk/credential-providers',
    ]),
    {},
  );

  await addGeneratorMetricsIfApplicable(tree, [
    TS_AGENT_GATEWAY_CONNECTION_GENERATOR_INFO,
  ]);

  // Guidance for the stack wiring the user still has to do themselves.
  console.log('');
  console.log(
    `✔ Connected ${agentComponent.name} agent to ${gatewayClassName} gateway.`,
  );
  console.log('');
  console.log('Add to the stack that instantiates your agent + gateway:');
  console.log('');
  console.log(
    `  ${gatewayClassName.charAt(0).toLowerCase()}${gatewayClassName.slice(1)}.grantInvokeAccess(agent);`,
  );
  console.log('');

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

export default tsAgentGatewayConnectionGenerator;
