/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GeneratorDefinition, ValidConnection } from './types';
import { TS_VERSIONS } from '../../../../packages/nx-plugin/src/utils/versions';

export const NX_VERSION = TS_VERSIONS['create-nx-workspace'];

export const GENERATORS: GeneratorDefinition[] = [
  {
    id: 'ts-react-website',
    label: 'React Website',
    description: 'TypeScript React static website',
    category: 'frontend',
    icon: 'react',
    iconColor: '#61DAFB',
    defaultName: 'website',
    generatorId: 'ts#react-website',
    connectionType: 'react',
    options: [
      {
        name: 'uxProvider',
        label: 'UI Kit',
        type: 'select',
        default: 'Cloudscape',
        choices: ['Cloudscape', 'Shadcn', 'None'],
      },
    ],
  },
  {
    id: 'ts-trpc-api',
    label: 'tRPC API',
    description: 'TypeScript tRPC backend API',
    category: 'backend',
    icon: 'trpc',
    iconColor: '#2596BE',
    defaultName: 'api',
    generatorId: 'ts#trpc-api',
    connectionType: 'ts#trpc-api',
    options: [
      {
        name: 'auth',
        label: 'Auth',
        type: 'select',
        default: 'IAM',
        choices: ['IAM', 'Cognito', 'None'],
      },
    ],
  },
  {
    id: 'py-fast-api',
    label: 'FastAPI',
    description: 'Python FastAPI backend',
    category: 'backend',
    icon: 'fastapi',
    iconColor: '#009688',
    defaultName: 'api',
    generatorId: 'py#fast-api',
    connectionType: 'py#fast-api',
    options: [
      {
        name: 'auth',
        label: 'Auth',
        type: 'select',
        default: 'IAM',
        choices: ['IAM', 'Cognito', 'None'],
      },
    ],
  },
  {
    id: 'ts-smithy-api',
    label: 'Smithy API',
    description: 'Smithy TypeScript server API',
    category: 'backend',
    icon: 'smithy',
    iconColor: '#E27152',
    defaultName: 'api',
    generatorId: 'ts#smithy-api',
    connectionType: 'smithy',
    options: [
      {
        name: 'auth',
        label: 'Auth',
        type: 'select',
        default: 'IAM',
        choices: ['IAM', 'Cognito', 'None'],
      },
    ],
  },
  {
    id: 'ts-strands-agent',
    label: 'TS Strands Agent',
    description: 'TypeScript AI Agent (Strands)',
    category: 'ai',
    icon: 'strands',
    iconColor: '#3178C6',
    defaultName: 'agent',
    generatorId: 'ts#strands-agent',
    hostProjectGenerator: 'ts#project',
    connectionType: 'ts#strands-agent',
    options: [
      {
        name: 'computeType',
        label: 'Compute',
        type: 'select',
        default: 'BedrockAgentCoreRuntime',
        choices: ['BedrockAgentCoreRuntime', 'None'],
      },
    ],
  },
  {
    id: 'py-strands-agent',
    label: 'PY Strands Agent',
    description: 'Python AI Agent (Strands)',
    category: 'ai',
    icon: 'strands',
    iconColor: '#FFD43B',
    defaultName: 'agent',
    generatorId: 'py#strands-agent',
    hostProjectGenerator: 'py#project',
    connectionType: 'py#strands-agent',
    options: [
      {
        name: 'computeType',
        label: 'Compute',
        type: 'select',
        default: 'BedrockAgentCoreRuntime',
        choices: ['BedrockAgentCoreRuntime', 'None'],
      },
    ],
  },
  {
    id: 'ts-mcp-server',
    label: 'TS MCP Server',
    description: 'TypeScript MCP Server',
    category: 'ai',
    icon: 'mcp',
    iconColor: '#3178C6',
    defaultName: 'mcp-server',
    generatorId: 'ts#mcp-server',
    hostProjectGenerator: 'ts#project',
    connectionType: 'ts#mcp-server',
    options: [
      {
        name: 'computeType',
        label: 'Compute',
        type: 'select',
        default: 'BedrockAgentCoreRuntime',
        choices: ['BedrockAgentCoreRuntime', 'None'],
      },
    ],
  },
  {
    id: 'py-mcp-server',
    label: 'PY MCP Server',
    description: 'Python MCP Server',
    category: 'ai',
    icon: 'mcp',
    iconColor: '#FFD43B',
    defaultName: 'mcp-server',
    generatorId: 'py#mcp-server',
    hostProjectGenerator: 'py#project',
    connectionType: 'py#mcp-server',
    options: [
      {
        name: 'computeType',
        label: 'Compute',
        type: 'select',
        default: 'BedrockAgentCoreRuntime',
        choices: ['BedrockAgentCoreRuntime', 'None'],
      },
    ],
  },
  {
    id: 'ts-infra',
    label: 'CDK Infra',
    description: 'CDK infrastructure application',
    category: 'infra',
    icon: 'cdk',
    iconColor: '#FF9900',
    defaultName: 'infra',
    generatorId: 'ts#infra',
    connectionType: 'ts#infra',
    options: [],
  },
  {
    id: 'terraform-project',
    label: 'Terraform',
    description: 'Terraform infrastructure project',
    category: 'infra',
    icon: 'terraform',
    iconColor: '#7B42BC',
    defaultName: 'infra',
    generatorId: 'terraform#project',
    connectionType: 'terraform#project',
    options: [],
  },
];

export const VALID_CONNECTIONS: ValidConnection[] = [
  { source: 'react', target: 'ts#trpc-api' },
  { source: 'react', target: 'py#fast-api' },
  { source: 'react', target: 'smithy' },
  { source: 'ts#strands-agent', target: 'ts#mcp-server' },
  { source: 'ts#strands-agent', target: 'py#mcp-server' },
];

export const CATEGORY_LABELS: Record<string, string> = {
  frontend: 'Frontend',
  backend: 'Backend',
  ai: 'AI & Agents',
  infra: 'Infrastructure',
};

export const getGeneratorById = (id: string): GeneratorDefinition | undefined =>
  GENERATORS.find((g) => g.id === id);

/** Check if this connection type appears as a source in any valid connection */
export const isConnectionSource = (connectionType: string): boolean =>
  VALID_CONNECTIONS.some((c) => c.source === connectionType);

/** Check if this connection type appears as a target in any valid connection */
export const isConnectionTarget = (connectionType: string): boolean =>
  VALID_CONNECTIONS.some((c) => c.target === connectionType);

/** Check if a source->target connection is valid */
export const isConnectionValid = (
  sourceConnectionType: string,
  targetConnectionType: string,
): boolean =>
  VALID_CONNECTIONS.some(
    (c) =>
      c.source === sourceConnectionType && c.target === targetConnectionType,
  );
