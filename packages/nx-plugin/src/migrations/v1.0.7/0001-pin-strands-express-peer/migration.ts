/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getProjects, joinPathFragments, type Tree } from '@nx/devkit';
import { AGENT_CONNECTION_PROJECT_DIR } from '../../../utils/agent-connection/agent-connection.js';
import { addDependenciesToPackageJson } from '../../../utils/dependencies.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { TS_VERSIONS } from '../../../utils/versions.js';

const EXPRESS = 'express';
const STRANDS_SDK = '@strands-agents/sdk';
const ROOT_PACKAGE_JSON = 'package.json';

/**
 * `express` is an optional peer of `@strands-agents/sdk` that any importer
 * declaring strands without also declaring express can leave undeclared. pnpm
 * suffixes each installed copy of a package by the versions of its peers, so
 * such an importer can resolve express to a different version than the pin
 * every other strands importer uses — splitting `@strands-agents/sdk` into two
 * peer-suffixed instances of the same version.
 *
 * Anything importing both instances then sees two nominal identities of every
 * SDK type — `Agent`, `McpClient`, `Plugin` — and fails to compile with "Types
 * have separate declarations of a private property". Declaring express
 * wherever strands is declared keeps the whole strands subgraph on the
 * catalog's single pin. Mirrors the earlier `@aws-sdk/client-s3` peer fix, one
 * optional peer further on.
 *
 * Detection is generic — every project's `package.json` plus the workspace
 * root, checked for "declares @strands-agents/sdk but not express" — rather
 * than listing the generators that currently produce that shape, so a future
 * strands importer this migration predates is still covered. The shared
 * agent-connection project is checked explicitly too, in case its project.json
 * is missing or not yet registered when this runs — `getProjects` would miss
 * it then, same as rc.95's `@aws-sdk/client-s3` migration guarded against.
 */
export default async function migration(tree: Tree): Promise<void> {
  pinIfNeeded(tree, ROOT_PACKAGE_JSON);
  pinIfNeeded(
    tree,
    joinPathFragments(AGENT_CONNECTION_PROJECT_DIR, 'package.json'),
  );

  for (const project of getProjects(tree).values()) {
    pinIfNeeded(tree, joinPathFragments(project.root, 'package.json'));
  }

  await formatFilesInSubtree(tree);
}

/** Declare express on the given manifest, if it declares strands but not express. */
function pinIfNeeded(tree: Tree, packageJsonPath: string): void {
  if (!tree.exists(packageJsonPath)) {
    return;
  }

  const packageJson = JSON.parse(tree.read(packageJsonPath, 'utf-8') ?? '{}');
  // Only where a strands client is actually declared — that is what pulls the
  // optional peer. An already-declared express (even a stale range) is left to
  // addDependenciesToPackageJson, which resolves it onto the catalog.
  if (!packageJson.dependencies?.[STRANDS_SDK]) {
    return;
  }

  addDependenciesToPackageJson(
    tree,
    { [EXPRESS]: TS_VERSIONS[EXPRESS] },
    {},
    packageJsonPath,
  );
}
