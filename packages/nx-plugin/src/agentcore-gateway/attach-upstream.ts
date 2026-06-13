/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  type ProjectConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { applyGritQL } from '../utils/ast';
import { addDependencyToTargetIfNotPresent } from '../utils/nx';

export interface LocalGatewayUpstream {
  /**
   * Gateway target name for the upstream — prefixes its tools as
   * `<targetName>___<toolName>` both locally and deployed.
   */
  targetName: string;
  /**
   * Local port the upstream MCP endpoint listens on.
   */
  port: number;
  /**
   * Project providing the upstream's serve-local target.
   */
  upstreamProjectName: string;
  /**
   * Name of the upstream's serve-local target.
   */
  upstreamServeLocalTargetName: string;
}

/**
 * Attach an upstream MCP endpoint (an MCP server or another gateway's local
 * gateway) to a gateway's local gateway.
 *
 * Chains the gateway's serve-local target onto the upstream's serve-local
 * target, and registers the upstream in the gateway's serve-local.ts so the
 * local gateway aggregates its tools.
 */
export const attachUpstreamToLocalGateway = async (
  tree: Tree,
  gatewayProject: ProjectConfiguration,
  gatewayServeLocalTargetName: string,
  upstream: LocalGatewayUpstream,
): Promise<void> => {
  // 1. Wire serve-local chain
  if (gatewayProject.targets?.[gatewayServeLocalTargetName]) {
    addDependencyToTargetIfNotPresent(
      gatewayProject,
      gatewayServeLocalTargetName,
      {
        projects: [upstream.upstreamProjectName],
        target: upstream.upstreamServeLocalTargetName,
      },
    );
    updateProjectConfiguration(tree, gatewayProject.name, gatewayProject);
  }

  // 2. Register the upstream in the gateway's local serve-local.ts
  const serveTsPath = joinPathFragments(gatewayProject.root, 'serve-local.ts');
  if (tree.exists(serveTsPath)) {
    const entry = `{ name: '${upstream.targetName}', url: 'http://localhost:${upstream.port}/mcp' }`;
    await applyGritQL(
      tree,
      serveTsPath,
      `or {
  \`const ATTACHED_MCP_SERVERS: AttachedMcpServer[] = []\` => \`const ATTACHED_MCP_SERVERS: AttachedMcpServer[] = [${entry}]\`,
  \`const ATTACHED_MCP_SERVERS: AttachedMcpServer[] = [$items]\` => \`const ATTACHED_MCP_SERVERS: AttachedMcpServer[] = [${entry}, $items]\` where {
    $items <: not contains \`'${upstream.targetName}'\`
  }
}`,
    );
  }
};
