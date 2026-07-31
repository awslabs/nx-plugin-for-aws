/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { readAgentCoreGatewayMetadata } from '../../../agentcore-gateway/generator';
import { addTsDependencies } from '../../../utils/add-dependencies';
import {
  AGENT_CONNECTION_DEPENDENCIES,
  AGENT_CONNECTION_PROJECT_DIR,
  addTypeScriptClientToAgent,
  addTypeScriptCoreClient,
  ensureTypeScriptAgentConnectionProject,
} from '../../../utils/agent-connection/agent-connection';
import { addDestructuredImport, addStarExport } from '../../../utils/ast';
import { declareDependencies } from '../../../utils/declared-dependencies';
import { formatFilesInSubtree } from '../../../utils/format';
import { installDependencies } from '../../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import { esmVars } from '../../../utils/module-format';
import { kebabCase } from '../../../utils/names';
import { getNpmScope } from '../../../utils/npm-scope';
import {
  addComponentGeneratorMetadata,
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import { toProjectRelativePath } from '../../../utils/paths';
import type { TsAgentGatewayConnectionGeneratorSchema } from './schema';

// The gateway core client + vended client need these whatever the connection's
// options, so no entry is conditional.
export const DEPENDENCIES = declareDependencies()({
  ts: [
    { name: '@modelcontextprotocol/sdk' },
    { name: '@strands-agents/sdk' },
    { name: '@aws-lambda-powertools/parameters' },
    { name: '@aws-sdk/client-appconfigdata' },
    { name: 'aws4fetch' },
    { name: '@aws-sdk/credential-providers' },
    ...AGENT_CONNECTION_DEPENDENCIES,
  ],
});

export const TS_AGENT_GATEWAY_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

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
      `Gateway '${gateway.name}' uses auth='${gateway.auth}'. Agent connections currently require the gateway to use IAM authentication.`,
    );
  }
  if (agentComponent.auth && agentComponent.auth !== 'iam') {
    throw new Error(
      `Agent '${agentComponent.name}' uses auth='${agentComponent.auth}'. Only IAM-authenticated agents can connect to IAM gateways.`,
    );
  }

  const gatewayClassName = gateway.rc;
  const gatewayKebabCase = kebabCase(gatewayClassName);
  // A gateway is its own standalone project, so it exposes plain serve / dev.
  const gatewayServeTargetName = 'serve';
  const gatewayDevTargetName = 'dev';

  const npmScope = getNpmScope(tree);

  // 1. Ensure the shared agent-connection project exists + has the gateway
  //    core client template.
  await ensureTypeScriptAgentConnectionProject(tree, DEPENDENCIES);
  await addTypeScriptCoreClient(tree, 'gateway', DEPENDENCIES);

  // 2. Generate the per-connection <Gateway>Client into app/. Local mode
  //    points at the gateway project's local gateway port.
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'agent-connection', 'app'),
    joinPathFragments(AGENT_CONNECTION_PROJECT_DIR, 'src', 'app'),
    {
      gatewayKebabCase,
      gatewayClassName,
      gatewayPort: gateway.port,
      ...esmVars(tree),
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Re-export from the agent-connection index
  await addStarExport(
    tree,
    joinPathFragments(AGENT_CONNECTION_PROJECT_DIR, 'src', 'index.ts'),
    `./app/${gatewayKebabCase}-client-strands.js`,
  );

  // 3. AST-transform agent.ts to add the gateway client (an McpClient in
  //    both deployed and local modes) to the agent's tools.
  const agentSourceDir = joinPathFragments(
    sourceProject.root,
    agentComponent.path ?? 'src',
  );
  const agentFilePath = joinPathFragments(agentSourceDir, 'agent.ts');

  if (tree.exists(agentFilePath)) {
    const clientClassName = `${gatewayClassName}ClientStrands`;
    const clientVarName =
      gatewayClassName.charAt(0).toLowerCase() + gatewayClassName.slice(1);

    await addDestructuredImport(
      tree,
      agentFilePath,
      [clientClassName],
      `@${npmScope}/agent-connection`,
    );
    await addTypeScriptClientToAgent(
      tree,
      agentFilePath,
      clientClassName,
      clientVarName,
    );
  }

  // 4. Wire dev chain — agent's dev depends on gateway's
  //    aggregator target, which transitively starts each attached MCP server.
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

  // 5. Dependencies
  addTsDependencies(tree, DEPENDENCIES, { projectRoot: sourceProject.root });

  // Recorded so the version sync knows this connection's dependencies are ours.
  addComponentGeneratorMetadata(
    tree,
    sourceProject.name,
    TS_AGENT_GATEWAY_CONNECTION_GENERATOR_INFO,
    toProjectRelativePath(sourceProject, agentFilePath),
    gatewayClassName,
  );

  await addGeneratorMetricsIfApplicable(tree, [
    TS_AGENT_GATEWAY_CONNECTION_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript'],
    });
};

export default tsAgentGatewayConnectionGenerator;
