/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export type Connection = { source: string; target: string };

/**
 * List of supported source and target project types for connections.
 * These can be project-level types (determined by introspection) or
 * component generator ids (from component metadata).
 */
export const SUPPORTED_PROJECT_TYPES = [
  'ts#trpc-api',
  'py#fast-api',
  'ts#react-website',
  'ts#smithy-api',
  'ts#rdb',
  'ts#dynamodb',
  'py#dynamodb',
  'agentcore-gateway',
] as const;

/**
 * Enumerates the supported project connections.
 * Source and target can be project-level types or component generator ids.
 *
 * This is the single source of truth for supported connections, kept in a
 * dependency-free module so it can be imported by the e2e connection matrix
 * without pulling in the generator implementation graph.
 */
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
] as const satisfies readonly Connection[];
