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
import { readAgentCoreGatewayMetadata } from '../../../agentcore-gateway/generator';
import {
  AGENT_CONNECTION_PROJECT_DIR,
  addTypeScriptClientToAgent,
  addTypeScriptCoreClient,
  addTypeScriptLangchainClientToAgent,
  ensureTypeScriptAgentConnectionProject,
} from '../../../utils/agent-connection/agent-connection';
import { addDestructuredImport, addStarExport } from '../../../utils/ast';
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
  if (!agentComponent) {
    throw new Error(
      'sourceComponent must be provided for ts#agent -> agentcore-gateway connections',
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
  const gatewayKebabCase = kebabCase(gatewayClassName);
  const gatewayServeTargetName = `${gatewayKebabCase}-serve`;
  const gatewayServeLocalTargetName = `${gatewayKebabCase}-serve-local`;

  // The transform applied to agent.ts depends on the source agent's framework:
  // Strands wraps `new Agent(...)` and spreads an McpClient into its tools;
  // LangChain loads StructuredTools and spreads them into createReactAgent(...).
  const framework =
    agentComponent.framework === 'langchain' ? 'langchain' : 'strands';
  const isLangchain = framework === 'langchain';
  const clientSuffix = isLangchain ? 'LangChain' : 'Strands';
  const clientModuleSuffix = isLangchain ? 'langchain' : 'strands';

  const npmScope = getNpmScope(tree);

  // 1. Ensure the shared agent-connection project exists + has the gateway
  //    core client for the source agent's framework.
  await ensureTypeScriptAgentConnectionProject(tree);
  await addTypeScriptCoreClient(tree, 'gateway', framework);

  // 2. Generate the per-connection <Gateway>Client into app/. Local mode
  //    points at the gateway project's local gateway port.
  generateFiles(
    tree,
    isLangchain
      ? joinPathFragments(__dirname, 'files', 'langchain', 'agent-connection', 'app')
      : joinPathFragments(__dirname, 'files', 'agent-connection', 'app'),
    joinPathFragments(AGENT_CONNECTION_PROJECT_DIR, 'src', 'app'),
    {
      gatewayKebabCase,
      gatewayClassName,
      gatewayPort: gateway.port,
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Re-export from the agent-connection index
  await addStarExport(
    tree,
    joinPathFragments(AGENT_CONNECTION_PROJECT_DIR, 'src', 'index.ts'),
    `./app/${gatewayKebabCase}-client-${clientModuleSuffix}.js`,
  );

  // 3. AST-transform agent.ts to add the gateway client's tools to the agent.
  const agentSourceDir = joinPathFragments(
    sourceProject.root,
    agentComponent.path ?? 'src',
  );
  const agentFilePath = joinPathFragments(agentSourceDir, 'agent.ts');

  if (tree.exists(agentFilePath)) {
    const clientClassName = `${gatewayClassName}Client${clientSuffix}`;
    const clientVarName =
      gatewayClassName.charAt(0).toLowerCase() + gatewayClassName.slice(1);

    await addDestructuredImport(
      tree,
      agentFilePath,
      [clientClassName],
      `:${npmScope}/agent-connection`,
    );
    if (isLangchain) {
      await addTypeScriptLangchainClientToAgent(
        tree,
        agentFilePath,
        clientClassName,
        clientVarName,
      );
    } else {
      await addTypeScriptClientToAgent(
        tree,
        agentFilePath,
        clientClassName,
        clientVarName,
      );
    }
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

  // 5. Dependencies. The Strands Layer-2 client pulls @strands-agents/sdk; the
  //    LangChain Layer-2 client pulls @langchain/mcp-adapters + @langchain/core
  //    (and must not pull Strands in).
  addDependenciesToPackageJson(
    tree,
    withVersions([
      '@modelcontextprotocol/sdk',
      '@aws-lambda-powertools/parameters',
      '@aws-sdk/client-appconfigdata',
      'aws4fetch',
      '@aws-sdk/credential-providers',
      ...(isLangchain
        ? (['@langchain/mcp-adapters', '@langchain/core'] as const)
        : (['@strands-agents/sdk'] as const)),
    ]),
    {},
  );

  await addGeneratorMetricsIfApplicable(tree, [
    TS_AGENT_GATEWAY_CONNECTION_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

export default tsAgentGatewayConnectionGenerator;
