/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  installPackagesTask,
  type Tree,
} from '@nx/devkit';
import { formatFilesInSubtree } from '../../utils/format';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { kebabCase } from '../../utils/names';
import {
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { attachUpstreamToLocalGateway } from '../attach-upstream';
import { readAgentCoreGatewayMetadata } from '../generator';
import type { AgentcoreGatewayMcpConnectionGeneratorSchema } from './schema';

export const AGENTCORE_GATEWAY_MCP_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

/**
 * Connect an AgentCore Gateway to an MCP server.
 *
 * Chains the gateway's dev target to the MCP server's dev
 * target, and registers the server in the gateway's local local-dev.ts so
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

  const gatewayDevTargetName = `${kebabCase(gateway.rc)}-dev`;

  // The target name must match what the deployed Gateway uses
  // (`mcpServerName` on the MCP construct, derived from the project's class
  // name) so `<target>___<tool>` resolves identically locally and deployed.
  // Component-level `name` would clash whenever two MCP server projects
  // both default to `mcp-server`.
  const mcpTargetName = kebabCase(mcpComponent.rc as string);
  const mcpComponentName = mcpComponent.name ?? 'mcp-server';

  await attachUpstreamToLocalGateway(
    tree,
    sourceProject,
    gatewayDevTargetName,
    {
      targetName: mcpTargetName,
      port: (mcpComponent.port as number | undefined) ?? 8000,
      upstreamProjectName: targetProject.name,
      upstreamDevTargetName: `${mcpComponentName}-dev`,
    },
  );

  await addGeneratorMetricsIfApplicable(tree, [
    AGENTCORE_GATEWAY_MCP_CONNECTION_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);

  return () => {
    installPackagesTask(tree);
  };
};

export default agentcoreGatewayMcpConnectionGenerator;
