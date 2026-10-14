/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
} from '@nx/devkit';
import { AGENT_CONNECTION_PROJECT_DIR } from '../../../utils/agent-connection/agent-connection.js';
import { addDependenciesToPackageJson } from '../../../utils/dependencies.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { TS_VERSIONS } from '../../../utils/versions.js';

const MCP_CLIENT = '@modelcontextprotocol/client';
const STRANDS_SDK = '@strands-agents/sdk';
const ROOT_PACKAGE_JSON = 'package.json';

/**
 * `@strands-agents/sdk` 1.20.0 replaced its required peer
 * `@modelcontextprotocol/sdk` with `@modelcontextprotocol/client`. Nothing in
 * a generated workspace declared that package, so pnpm auto-installs whatever
 * its `latest` is, while the vended `@modelcontextprotocol/inspector` pulls
 * its own exact version into the same graph. The generators now declare it
 * at the vended pin wherever they declare strands; this carries an existing
 * workspace to the same shape.
 *
 * Detection is generic, as in the earlier express peer migration: the
 * workspace root, the shared agent-connection project (checked explicitly in
 * case its project.json isn't registered) and every project's
 * `package.json`, each checked for "declares @strands-agents/sdk".
 */
export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  pinIfNeeded(tree, ROOT_PACKAGE_JSON);
  pinIfNeeded(
    tree,
    joinPathFragments(AGENT_CONNECTION_PROJECT_DIR, 'package.json'),
  );

  for (const project of getProjects(tree).values()) {
    pinIfNeeded(tree, joinPathFragments(project.root, 'package.json'));
  }

  await formatFilesInSubtree(tree);

  return { nextSteps: [] };
}

/** Declare the MCP client on the given manifest, if it declares strands. */
function pinIfNeeded(tree: Tree, packageJsonPath: string): void {
  if (!tree.exists(packageJsonPath)) {
    return;
  }

  const packageJson = JSON.parse(tree.read(packageJsonPath, 'utf-8') ?? '{}');
  if (!packageJson.dependencies?.[STRANDS_SDK]) {
    return;
  }

  // An already-declared client (even a stale range) is left to
  // addDependenciesToPackageJson, which resolves it onto the catalog.
  addDependenciesToPackageJson(
    tree,
    { [MCP_CLIENT]: TS_VERSIONS[MCP_CLIENT] },
    {},
    packageJsonPath,
  );
}
