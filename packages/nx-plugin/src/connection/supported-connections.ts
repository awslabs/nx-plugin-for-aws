/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export type Connection = { source: string; target: string };

// Supported source/target project types: either project-level types (resolved
// by introspection) or component generator ids (from component metadata).
export const SUPPORTED_PROJECT_TYPES = [
  'ts#trpc-api',
  'py#fast-api',
  'ts#react-website',
  'ts#smithy-api',
  'ts#rdb',
  'py#rdb',
  'ts#dynamodb',
  'py#dynamodb',
  'agentcore-gateway',
] as const;

// The single source of truth for supported connections, in a dependency-free
// module so the e2e connection matrix can import it without pulling in the
// generator implementation graph.
export const SUPPORTED_CONNECTIONS = [
  { source: 'ts#trpc-api', target: 'ts#rdb' },
  { source: 'ts#trpc-api', target: 'ts#dynamodb' },
  { source: 'ts#agent', target: 'ts#rdb' },
  { source: 'ts#smithy-api', target: 'ts#rdb' },
  { source: 'ts#smithy-api', target: 'ts#dynamodb' },
  { source: 'ts#mcp-server', target: 'ts#rdb' },
  { source: 'ts#mcp-server', target: 'ts#dynamodb' },
  { source: 'ts#react-website', target: 'ts#trpc-api' },
  { source: 'ts#react-website', target: 'py#fast-api' },
  { source: 'ts#react-website', target: 'ts#smithy-api' },
  { source: 'ts#react-website', target: 'ts#agent' },
  { source: 'ts#react-website', target: 'py#agent' },
  { source: 'ts#agent', target: 'ts#mcp-server' },
  { source: 'ts#agent', target: 'py#mcp-server' },
  { source: 'ts#agent', target: 'ts#dynamodb' },
  { source: 'py#agent', target: 'ts#mcp-server' },
  { source: 'py#agent', target: 'py#mcp-server' },
  { source: 'ts#agent', target: 'ts#agent' },
  { source: 'ts#agent', target: 'py#agent' },
  { source: 'py#agent', target: 'ts#agent' },
  { source: 'py#agent', target: 'py#agent' },
  { source: 'ts#agent', target: 'agentcore-gateway' },
  { source: 'py#agent', target: 'agentcore-gateway' },
  { source: 'agentcore-gateway', target: 'ts#mcp-server' },
  { source: 'agentcore-gateway', target: 'py#mcp-server' },
  { source: 'agentcore-gateway', target: 'agentcore-gateway' },
  { source: 'py#fast-api', target: 'py#dynamodb' },
  { source: 'py#agent', target: 'py#dynamodb' },
  { source: 'py#mcp-server', target: 'py#dynamodb' },
  { source: 'py#fast-api', target: 'py#rdb' },
  { source: 'py#agent', target: 'py#rdb' },
  { source: 'py#mcp-server', target: 'py#rdb' },
] as const satisfies readonly Connection[];

// `<source> -> <target>` string union of every supported connection. Used to
// key exhaustive maps so a new connection is a compile error until handled.
export type ConnectionKey =
  (typeof SUPPORTED_CONNECTIONS)[number] extends infer C
    ? C extends Connection
      ? `${C['source']} -> ${C['target']}`
      : never
    : never;
