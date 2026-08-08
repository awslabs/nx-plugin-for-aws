/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { GeneratorCallback, Tree } from '@nx/devkit';
import { formatFilesInSubtree } from '../../utils/format';
import { installDependencies } from '../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { kebabCase, toClassName } from '../../utils/names';
import {
  addComponentGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { attachAgentToLocalGateway } from '../attach-upstream';
import { readAgentCoreGatewayMetadata } from '../generator';
import type { AgentcoreGatewayAgentConnectionGeneratorSchema } from './schema';

export const AGENTCORE_GATEWAY_AGENT_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

/**
 * The agent protocols an http gateway can front, by agent language. The
 * gateway proxies plain HTTP request/response and SSE streams:
 *
 * - `ag-ui` (ts + py) and `http` (py) serve POST /invocations with streamed
 *   responses, which proxy cleanly.
 * - `a2a` (ts + py) is JSON-RPC over POST, which AgentCore applies a default
 *   schema for.
 * - `http` (ts) is tRPC over WebSocket, and the gateway does not support
 *   WebSocket / bidirectional streaming, so it cannot sit behind one.
 */
const SUPPORTED_AGENT_PROTOCOLS: Record<string, string[]> = {
  'ts#agent': ['ag-ui', 'a2a'],
  'py#agent': ['ag-ui', 'http', 'a2a'],
};

/**
 * Connect an AgentCore Gateway to an agent, so the agent is added as a
 * gateway target and served under `<gatewayUrl>/<targetName>/invocations`.
 *
 * Chains the gateway's dev target to the agent's dev target, and registers
 * the agent in the gateway's local-dev.ts so the local gateway proxies to it.
 * Users must still call `gateway.addAgent(...)` in their application stack to
 * create the actual CDK/Terraform resource.
 */
export const agentcoreGatewayAgentConnectionGenerator = async (
  tree: Tree,
  options: AgentcoreGatewayAgentConnectionGeneratorSchema,
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
  const agentComponent = options.targetComponent;

  if (!agentComponent) {
    throw new Error(
      `Target project '${options.targetProject}' has no agent component metadata. Did you run the 'ts#agent' or 'py#agent' generator?`,
    );
  }

  if (gateway.protocol !== 'http') {
    throw new Error(
      `Gateway '${gateway.name}' has protocol='${gateway.protocol}'. Agent targets can only be attached to http-protocol gateways — generate one with the 'agentcore-gateway' generator and --protocol=http.`,
    );
  }

  const agentGenerator = agentComponent.generator ?? 'ts#agent';
  const agentProtocol = (
    (agentComponent.protocol as string | undefined) ?? 'http'
  ).toLowerCase();
  const supportedProtocols = SUPPORTED_AGENT_PROTOCOLS[agentGenerator] ?? [];
  if (!supportedProtocols.includes(agentProtocol)) {
    throw new Error(
      `Agent '${agentComponent.name}' uses protocol='${agentProtocol}', which cannot be fronted by a gateway` +
        (agentGenerator === 'ts#agent' && agentProtocol === 'http'
          ? ` — a TypeScript HTTP agent serves tRPC over WebSocket, and AgentCore Gateway does not support WebSocket streaming. Consider the ag-ui protocol instead.`
          : `. Supported protocols: ${supportedProtocols.join(', ')}.`),
    );
  }
  // Both IAM and Cognito agents can be fronted. An IAM agent is invoked with
  // the gateway's own role (GATEWAY_IAM_ROLE); a Cognito agent has the caller's
  // JWT forwarded to it (JWT_PASSTHROUGH) so it authorizes on the token. The
  // vended `addAgent` picks the credential from the agent's `auth`.
  const agentAuth = (agentComponent.auth as string | undefined) ?? 'iam';
  if (agentAuth !== 'iam' && agentAuth !== 'cognito') {
    throw new Error(
      `Agent '${agentComponent.name}' uses auth='${agentAuth}', which a gateway cannot front. Supported: iam, cognito.`,
    );
  }

  // The target name must match what the deployed Gateway uses (`agentName` on
  // the agent construct, derived from the project's class name) so the
  // `/<target>/invocations` path resolves identically locally and deployed.
  const agentComponentName = agentComponent.name ?? 'agent';
  const agentTargetName = kebabCase(
    (agentComponent.rc as string | undefined) ??
      toClassName(agentComponentName),
  );

  await attachAgentToLocalGateway(tree, sourceProject, 'dev', {
    targetName: agentTargetName,
    port: (agentComponent.port as number | undefined) ?? 8081,
    upstreamProjectName: targetProject.name,
    upstreamDevTargetName: `${agentComponentName}-dev`,
    // The deployed gateway maps an A2A target's `/invocations/...` paths onto
    // the agent container's root; HTTP and AG-UI agents serve /invocations
    // themselves.
    stripInvocations: agentProtocol === 'a2a',
  });

  // Recorded so the version sync can identify this connection.
  addComponentGeneratorMetadata(
    tree,
    sourceProject.name,
    AGENTCORE_GATEWAY_AGENT_CONNECTION_GENERATOR_INFO,
    targetProject.root,
    agentTargetName,
  );

  await addGeneratorMetricsIfApplicable(tree, [
    AGENTCORE_GATEWAY_AGENT_CONNECTION_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);

  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript'],
    });
};

export default agentcoreGatewayAgentConnectionGenerator;
