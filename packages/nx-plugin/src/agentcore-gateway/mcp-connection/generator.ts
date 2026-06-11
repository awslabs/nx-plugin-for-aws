/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  installPackagesTask,
  joinPathFragments,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { applyGritQL } from '../../utils/ast';
import { formatFilesInSubtree } from '../../utils/format';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { kebabCase } from '../../utils/names';
import {
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { readAgentCoreGatewayMetadata } from '../generator';
import type { AgentcoreGatewayMcpConnectionGeneratorSchema } from './schema';

export const AGENTCORE_GATEWAY_MCP_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

/**
 * Connect an AgentCore Gateway to an MCP server.
 *
 * Chains the gateway's serve-local target to the MCP server's serve-local
 * target, and registers the server in the gateway's local serve-local.ts so
 * the local gateway aggregates its tools. Users must still call
 * `gateway.addMcpServer(...)` in their application stack to create the
 * actual CDK/Terraform resource.
 */
export const agentcoreGatewayMcpConnectionGenerator = async (
  tree: Tree,
  options: AgentcoreGatewayMcpConnectionGeneratorSchema,
): Promise<GeneratorCallback> => {
  const sourceProject = readProjectConfigurationUnqualified(
    tree,
    options.sourceProject,
  );
  const targetProject = readProjectConfigurationUnqualified(
    tree,
    options.targetProject,
  );

  const gateway = readAgentCoreGatewayMetadata(sourceProject);
  const mcpComponent = options.targetComponent;

  if (!mcpComponent) {
    throw new Error(
      `Target project '${options.targetProject}' has no MCP server component metadata. Did you run the 'ts#mcp-server' or 'py#mcp-server' generator?`,
    );
  }

  if (gateway.protocol !== 'mcp') {
    throw new Error(
      `Gateway '${gateway.name}' has protocol='${gateway.protocol}'. MCP server targets can only be attached to MCP-protocol gateways.`,
    );
  }
  if (mcpComponent.auth && mcpComponent.auth !== 'iam') {
    throw new Error(
      `MCP server '${mcpComponent.name}' uses auth='${mcpComponent.auth}'. Gateway->MCP connections currently require the MCP server to use IAM authentication.`,
    );
  }

  const gatewayKebabCase = kebabCase(gateway.rc);
  const gatewayServeLocalTargetName = `${gatewayKebabCase}-serve-local`;

  const mcpComponentName = mcpComponent.name ?? 'mcp-server';
  const mcpServeLocalTargetName = `${mcpComponentName}-serve-local`;
  const mcpPort = (mcpComponent.port as number | undefined) ?? 8000;

  // 1. Wire serve-local chain
  if (sourceProject.targets?.[gatewayServeLocalTargetName]) {
    addDependencyToTargetIfNotPresent(
      sourceProject,
      gatewayServeLocalTargetName,
      {
        projects: [targetProject.name],
        target: mcpServeLocalTargetName,
      },
    );
    updateProjectConfiguration(tree, sourceProject.name, sourceProject);
  }

  // 2. Register the MCP server in the gateway's local serve-local.ts
  const serveTsPath = joinPathFragments(sourceProject.root, 'serve-local.ts');
  if (tree.exists(serveTsPath)) {
    const entry = `{ name: '${mcpComponentName}', url: 'http://localhost:${mcpPort}/mcp' }`;
    await applyGritQL(
      tree,
      serveTsPath,
      `or {
  \`const ATTACHED_MCP_SERVERS = []\` => \`const ATTACHED_MCP_SERVERS = [${entry}]\`,
  \`const ATTACHED_MCP_SERVERS = [$items]\` => \`const ATTACHED_MCP_SERVERS = [${entry}, $items]\` where {
    $items <: not contains \`'${mcpComponentName}'\`
  }
}`,
    );
  }

  await addGeneratorMetricsIfApplicable(tree, [
    AGENTCORE_GATEWAY_MCP_CONNECTION_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);

  return () => {
    installPackagesTask(tree);
  };
};

export default agentcoreGatewayMcpConnectionGenerator;
