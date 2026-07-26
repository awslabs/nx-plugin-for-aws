/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { MigrationReturnObject, Tree } from '@nx/devkit';
import { syncVendedVersions } from './sync-vended-versions';

/**
 * Syncs the workspace's vended versions to those the installed plugin vends.
 *
 * Every release's version update registers a `migrations.json` entry pointing
 * here, so each upgrade hop runs this once with that release's versions.
 */
export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  return syncVendedVersions(tree);
}
