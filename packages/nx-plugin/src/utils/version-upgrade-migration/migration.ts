/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { MigrationReturnObject, Tree } from '@nx/devkit';
import { syncVendedVersions } from './sync-vended-versions';

/**
 * Syncs the workspace's vended versions to those the installed plugin vends.
 *
 * Registered `everyMigration`, so it runs on every upgrade and last in the run:
 * versions come from the installed plugin's own tables, so there is nothing
 * release-specific to register, and running after the code migrations lets them
 * add dependencies this then brings up to date.
 */
export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  return syncVendedVersions(tree);
}
