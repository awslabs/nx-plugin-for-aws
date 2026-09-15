/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { joinPathFragments, type Tree } from '@nx/devkit';
import { AGENT_CONNECTION_PROJECT_DIR } from '../../../utils/agent-connection/agent-connection.js';
import { addDependenciesToPackageJson } from '../../../utils/dependencies.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { TS_VERSIONS } from '../../../utils/versions.js';

const CLIENT_S3 = '@aws-sdk/client-s3';
const STRANDS_SDK = '@strands-agents/sdk';

/**
 * `@aws-sdk/client-s3` is an optional peer of `@strands-agents/sdk` that the
 * shared agent-connection project never imports, so it went undeclared. pnpm
 * then auto-installs its own copy there while a project that does declare it
 * gets the catalog's, and those two resolutions give `@strands-agents/sdk` two
 * peer-suffixed instances of the same version.
 *
 * Anything importing both projects then sees two nominal identities of every SDK
 * type — `Agent`, `McpClient`, `Plugin` — and fails to compile with "Types have
 * separate declarations of a private property". Declaring it keeps the version
 * on the catalog, collapsing both to one instance.
 */
export default async function migration(tree: Tree): Promise<void> {
  const packageJsonPath = joinPathFragments(
    AGENT_CONNECTION_PROJECT_DIR,
    'package.json',
  );
  if (!tree.exists(packageJsonPath)) {
    return;
  }

  // Only where a strands client is actually present — that is what pulls the peer.
  const packageJson = JSON.parse(tree.read(packageJsonPath, 'utf-8') ?? '{}');
  if (!packageJson.dependencies?.[STRANDS_SDK]) {
    return;
  }

  addDependenciesToPackageJson(
    tree,
    { [CLIENT_S3]: TS_VERSIONS[CLIENT_S3] },
    {},
    packageJsonPath,
  );

  await formatFilesInSubtree(tree);
}
