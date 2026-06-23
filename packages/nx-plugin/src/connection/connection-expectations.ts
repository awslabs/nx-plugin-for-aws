/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ConnectionKey } from './generator';
import type { DimensionValues } from './permutations';

/**
 * The expected outcome of running the connection generator for a single
 * permutation (one choice of source + target dimension values).
 *
 * - `supported` — the generator must succeed and vend valid (buildable) code.
 * - `unsupported` — the generator must throw, and the message must match
 *   `errorMatches` so users get a clear "not supported" signal rather than a
 *   crash or, worse, silently broken generated code.
 */
export type ConnectionOutcome =
  | { kind: 'supported' }
  | { kind: 'unsupported'; errorMatches: RegExp };

const supported = (): ConnectionOutcome => ({ kind: 'supported' });
const unsupported = (errorMatches: RegExp): ConnectionOutcome => ({
  kind: 'unsupported',
  errorMatches,
});

/**
 * Classifies a single connection permutation as supported or unsupported.
 * Receives the resolved source/target dimension values (every enum property of
 * each side's schema). Must return an outcome for *every* combination of the
 * current enum values — the exhaustiveness test fails the build if any cell is
 * left unclassified, which is what forces a contributor to consciously consider
 * a newly added dimension value (e.g. a new agent `framework`).
 */
export type ConnectionExpectation = (cell: {
  source: DimensionValues;
  target: DimensionValues;
}) => ConnectionOutcome;

// Error fragments thrown by the leaf connection generators. Kept here so the
// expectation table reads as a single source of truth for "what the user sees".
const ERR_AGENT_FRAMEWORK = /does not support/; // frameworkLanguage(): unknown framework/protocol
const ERR_MCP_IAM = /only supports IAM authentication/;
const ERR_A2A_PROTOCOL = /only A2A agents can be connected/;
const ERR_A2A_IAM = /only supports IAM authentication/;
const ERR_GATEWAY_AGENT_IAM = /Only IAM-authenticated agents can connect/;
const ERR_GATEWAY_MCP_IAM = /require the MCP server to use IAM/;
const ERR_REACT_A2A = /Cannot connect a React website to an A2A agent/;

/** The only agent framework currently wired into the connection clients. */
const SUPPORTED_AGENT_FRAMEWORK = 'strands';

/**
 * An agent connecting over a framework-specific client (mcp/a2a/gateway) only
 * works for frameworks wired into the connection-client registry. A new
 * `framework` enum value with no registry entry must throw, not vend broken code.
 */
const agentFrameworkSupported = (agent: DimensionValues): boolean =>
  agent.framework === SUPPORTED_AGENT_FRAMEWORK;

/**
 * Expected outcome per supported routing pair, across the full cartesian of
 * both sides' schema enums. Every key in {@link SUPPORTED_CONNECTIONS} must
 * appear here (enforced by the exhaustiveness test).
 */
export const CONNECTION_EXPECTATIONS: Record<
  ConnectionKey,
  ConnectionExpectation
> = {
  // --- React frontend -> API (framework-agnostic client generation) ---
  'react -> ts#trpc-api': supported,
  'react -> py#fast-api': supported,
  'react -> smithy': supported,

  // --- React frontend -> Agent (HTTP/AG-UI only; A2A has no browser client) ---
  'react -> ts#agent': ({ target }) =>
    target.protocol === 'a2a' ? unsupported(ERR_REACT_A2A) : supported(),
  'react -> py#agent': ({ target }) =>
    target.protocol === 'a2a' ? unsupported(ERR_REACT_A2A) : supported(),

  // --- API -> Database (framework-agnostic) ---
  'ts#trpc-api -> ts#rdb': supported,
  'ts#trpc-api -> ts#dynamodb': supported,
  'smithy -> ts#rdb': supported,
  'smithy -> ts#dynamodb': supported,
  'py#fast-api -> py#dynamodb': supported,

  // --- MCP server -> Database (framework-agnostic) ---
  'ts#mcp-server -> ts#rdb': supported,
  'ts#mcp-server -> ts#dynamodb': supported,
  'py#mcp-server -> py#dynamodb': supported,

  // --- Agent -> Database (framework-agnostic data-access client) ---
  'ts#agent -> ts#rdb': supported,
  'ts#agent -> ts#dynamodb': supported,
  'py#agent -> py#dynamodb': supported,

  // --- Agent -> MCP server (IAM-auth target + framework-specific client) ---
  'ts#agent -> ts#mcp-server': agentMcp,
  'ts#agent -> py#mcp-server': agentMcp,
  'py#agent -> ts#mcp-server': agentMcp,
  'py#agent -> py#mcp-server': agentMcp,

  // --- Agent -> Agent (A2A: target must speak A2A, IAM auth, known framework) ---
  'ts#agent -> ts#agent': agentA2a,
  'ts#agent -> py#agent': agentA2a,
  'py#agent -> ts#agent': agentA2a,
  'py#agent -> py#agent': agentA2a,

  // --- Agent -> AgentCore Gateway (IAM-auth agent + known framework) ---
  'ts#agent -> agentcore-gateway': agentGateway,
  'py#agent -> agentcore-gateway': agentGateway,

  // --- AgentCore Gateway -> MCP server (IAM-auth MCP target) ---
  'agentcore-gateway -> ts#mcp-server': ({ target }) =>
    target.auth === 'iam' ? supported() : unsupported(ERR_GATEWAY_MCP_IAM),
  'agentcore-gateway -> py#mcp-server': ({ target }) =>
    target.auth === 'iam' ? supported() : unsupported(ERR_GATEWAY_MCP_IAM),

  // --- AgentCore Gateway -> AgentCore Gateway (target IAM auth; enum is iam-only) ---
  'agentcore-gateway -> agentcore-gateway': supported,
};

/** Agent -> MCP server: target must use IAM, agent framework must be known. */
function agentMcp({
  source,
  target,
}: {
  source: DimensionValues;
  target: DimensionValues;
}): ConnectionOutcome {
  if (target.auth !== 'iam') return unsupported(ERR_MCP_IAM);
  if (!agentFrameworkSupported(source)) return unsupported(ERR_AGENT_FRAMEWORK);
  return supported();
}

/** Agent -> Agent: target must speak A2A + use IAM, source framework known. */
function agentA2a({
  source,
  target,
}: {
  source: DimensionValues;
  target: DimensionValues;
}): ConnectionOutcome {
  if (target.protocol !== 'a2a') return unsupported(ERR_A2A_PROTOCOL);
  if (target.auth !== 'iam') return unsupported(ERR_A2A_IAM);
  if (!agentFrameworkSupported(source)) return unsupported(ERR_AGENT_FRAMEWORK);
  return supported();
}

/** Agent -> Gateway: agent must use IAM, agent framework must be known. */
function agentGateway({
  source,
}: {
  source: DimensionValues;
  target: DimensionValues;
}): ConnectionOutcome {
  if (source.auth !== 'iam') return unsupported(ERR_GATEWAY_AGENT_IAM);
  if (!agentFrameworkSupported(source)) return unsupported(ERR_AGENT_FRAMEWORK);
  return supported();
}
