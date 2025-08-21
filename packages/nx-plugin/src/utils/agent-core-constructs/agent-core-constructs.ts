/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
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
    joinPathFragments(__dirname, 'files', 'app', 'mcp-servers'),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'mcp-servers',
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
      'mcp-servers',
      'index.ts',
    ),
    `./${options.mcpServerNameKebabCase}/${options.mcpServerNameKebabCase}.js`,
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
    './mcp-servers/index.js',
  );
};
