/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type Tree, updateJson } from '@nx/devkit';
import {
  LATEST_MIGRATIONS_DIR,
  type MigrationsJson,
} from '../migration-versions';
import { nxPackageJsonUpdates } from './nx-package-updates';

const MIGRATIONS_JSON_PATH = 'packages/nx-plugin/migrations.json';

/**
 * Register the nx bump a version update needs, in `migrations.json`. Call only
 * when an nx package actually moved.
 *
 * The version sync migration itself is a committed `everyMigration` entry, so
 * only the nx packages need registering per update: they go through
 * `packageJsonUpdates` rather than a migration (see `nx-package-updates.ts`).
 *
 * A bump already dated by a release stays — a workspace several releases behind
 * needs each hop in turn. One still waiting for a release is dropped: this bump
 * supersedes it, and both would otherwise ship under the same version, leaving
 * which nx a workspace lands on down to the order nx happens to apply them in.
 *
 * Idempotent: re-running before a release replaces the pending entry with itself.
 *
 * @param nxVersion nx version being moved to. The update script rewrites
 *   `versions.ts` on the tree, which cannot change the `NX_VERSION` this process
 *   imported at load — so the caller passes the version it just wrote, or the
 *   entry would record the one being replaced.
 * @returns paths written, for the update report
 */
export const registerNxPackageUpdates = (
  tree: Tree,
  nxVersion?: string,
): string[] => {
  updateJson<MigrationsJson>(tree, MIGRATIONS_JSON_PATH, (migrations) => ({
    ...migrations,
    // Recorded under `latest` until stamping resolves the version it ships with.
    packageJsonUpdates: {
      ...Object.fromEntries(
        Object.entries(migrations.packageJsonUpdates ?? {}).filter(
          ([, entry]) => entry.version !== LATEST_MIGRATIONS_DIR,
        ),
      ),
      ...nxPackageJsonUpdates(LATEST_MIGRATIONS_DIR, nxVersion),
    },
  }));

  return [MIGRATIONS_JSON_PATH];
};
