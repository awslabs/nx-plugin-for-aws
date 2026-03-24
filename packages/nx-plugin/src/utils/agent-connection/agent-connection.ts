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
import tsProjectGenerator from '../../ts/lib/generator';

const AGENT_CONNECTION_DIR = 'agent-connection';
const PACKAGES_DIR = 'packages';
const COMMON_DIR = 'common';

export const AGENT_CONNECTION_PROJECT_DIR = joinPathFragments(
  PACKAGES_DIR,
  COMMON_DIR,
  AGENT_CONNECTION_DIR,
);

/**
 * Ensure the shared TypeScript agent-connection project exists.
 * Creates the project with the core AgentCoreMcpClient if it doesn't exist.
 */
export async function ensureTypeScriptAgentConnectionProject(
  tree: Tree,
): Promise<void> {
  const projectJsonPath = joinPathFragments(
    AGENT_CONNECTION_PROJECT_DIR,
    'project.json',
  );
  if (tree.exists(projectJsonPath)) {
    return; // Already exists
  }

  // Create the TS project
  await tsProjectGenerator(tree, {
    name: AGENT_CONNECTION_DIR,
    directory: joinPathFragments(PACKAGES_DIR, COMMON_DIR),
  });

  // Generate the core files (agentcore-mcp-client.ts)
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'core'),
    joinPathFragments(AGENT_CONNECTION_PROJECT_DIR, 'src', 'core'),
    {},
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );
}
