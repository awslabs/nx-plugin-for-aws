/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  Tree,
} from '@nx/devkit';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../shared-constructs-constants';
import { addStarExport } from '../ast';
import { withVersions } from '../versions';

export interface AddAgentCoreConstructProps {
  nameClassName: string;
  nameKebabCase: string;
  dockerImageTag: string;
  appDirectory: string;
  serverProtocol: 'MCP' | 'HTTP';
}

const addAgentCoreConstruct = (
  tree: Tree,
  options: AddAgentCoreConstructProps,
) => {
  // Construct uses bedrock agentcore types
  addDependenciesToPackageJson(
    tree,
    {},
    withVersions(['@aws-sdk/client-bedrock-agentcore-control']),
  );

  // Add the AgentCore runtime construct
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'core', 'agent-core'),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'core',
      'agent-core',
    ),
    {},
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  // Generate app specific CDK construct
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'app', 'agent-core'),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      options.appDirectory,
    ),
    options,
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  // Export app specific CDK construct
  addStarExport(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      options.appDirectory,
      'index.ts',
    ),
    `./${options.nameKebabCase}/${options.nameKebabCase}.js`,
  );
  addStarExport(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'index.ts',
    ),
    `./${options.appDirectory}/index.js`,
  );
};

export interface AddMcpServerConstructProps {
  mcpServerNameClassName: string;
  mcpServerNameKebabCase: string;
  dockerImageTag: string;
}

/**
 * Add an MCP server CDK construct
 */
export const addMcpServerConstruct = (
  tree: Tree,
  options: AddMcpServerConstructProps,
) => {
  addAgentCoreConstruct(tree, {
    nameClassName: options.mcpServerNameClassName,
    nameKebabCase: options.mcpServerNameKebabCase,
    dockerImageTag: options.dockerImageTag,
    appDirectory: 'mcp-servers',
    serverProtocol: 'MCP',
  });
};

export interface AddAgentConstructProps {
  agentNameClassName: string;
  agentNameKebabCase: string;
  dockerImageTag: string;
}

/**
 * Add an MCP server CDK construct
 */
export const addAgentConstruct = (
  tree: Tree,
  options: AddAgentConstructProps,
) => {
  addAgentCoreConstruct(tree, {
    nameClassName: options.agentNameClassName,
    nameKebabCase: options.agentNameKebabCase,
    dockerImageTag: options.dockerImageTag,
    appDirectory: 'agents',
    serverProtocol: 'HTTP',
  });
};
