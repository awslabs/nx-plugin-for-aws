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
import { applyGritQL } from '../utils/ast.js';
import { addDependencyToTargetIfNotPresent } from '../utils/nx.js';

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
   * Project providing the upstream's dev target.
   */
  upstreamProjectName: string;
  /**
   * Name of the upstream's dev target.
   */
  upstreamDevTargetName: string;
}

/**
 * Attach an upstream MCP endpoint (an MCP server or another gateway's local
 * gateway) to a gateway's local gateway.
 *
 * Chains the gateway's dev target onto the upstream's dev target, and
 * registers the upstream in the gateway's local-dev.ts so the local gateway
 * aggregates its tools.
 */
export const attachUpstreamToLocalGateway = async (
  tree: Tree,
  gatewayProject: ProjectConfiguration,
  gatewayDevTargetName: string,
  upstream: LocalGatewayUpstream,
): Promise<void> => {
  chainGatewayDevTarget(tree, gatewayProject, gatewayDevTargetName, upstream);

  // Register the upstream in the gateway's local local-dev.ts
  const serveTsPath = joinPathFragments(gatewayProject.root, 'local-dev.ts');
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

/**
 * Attach an upstream agent to an http gateway's local gateway.
 *
 * Chains the gateway's dev target onto the agent's dev target, and registers
 * the agent in the gateway's local-dev.ts so the local gateway proxies
 * `/<targetName>/...` to it.
 */
export const attachAgentToLocalGateway = async (
  tree: Tree,
  gatewayProject: ProjectConfiguration,
  gatewayDevTargetName: string,
  upstream: LocalGatewayUpstream & {
    /**
     * Whether to strip the `/invocations` path prefix when proxying. The
     * deployed gateway maps an A2A target's `/invocations/...` paths onto the
     * agent container's root, so the local proxy does the same; HTTP and
     * AG-UI agents serve `/invocations` themselves.
     */
    stripInvocations: boolean;
  },
): Promise<void> => {
  chainGatewayDevTarget(tree, gatewayProject, gatewayDevTargetName, upstream);

  const serveTsPath = joinPathFragments(gatewayProject.root, 'local-dev.ts');
  if (tree.exists(serveTsPath)) {
    const entry = `{ name: '${upstream.targetName}', url: 'http://localhost:${upstream.port}', stripInvocations: ${upstream.stripInvocations} }`;
    await applyGritQL(
      tree,
      serveTsPath,
      `or {
  \`const ATTACHED_AGENTS: AttachedAgent[] = []\` => \`const ATTACHED_AGENTS: AttachedAgent[] = [${entry}]\`,
  \`const ATTACHED_AGENTS: AttachedAgent[] = [$items]\` => \`const ATTACHED_AGENTS: AttachedAgent[] = [${entry}, $items]\` where {
    $items <: not contains \`'${upstream.targetName}'\`
  }
}`,
    );
  }
};

/** Chain the gateway's dev target onto the upstream's dev target. */
const chainGatewayDevTarget = (
  tree: Tree,
  gatewayProject: ProjectConfiguration,
  gatewayDevTargetName: string,
  upstream: LocalGatewayUpstream,
): void => {
  if (gatewayProject.targets?.[gatewayDevTargetName]) {
    addDependencyToTargetIfNotPresent(gatewayProject, gatewayDevTargetName, {
      projects: [upstream.upstreamProjectName],
      target: upstream.upstreamDevTargetName,
    });
    updateProjectConfiguration(tree, gatewayProject.name, gatewayProject);
  }
};
