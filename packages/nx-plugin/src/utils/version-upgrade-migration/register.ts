/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import {
  LATEST_MIGRATIONS_DIR,
  type MigrationsJson,
  migrationKey,
} from '../migration-versions';
import { nxPackageJsonUpdates } from './nx-package-updates';

const MIGRATIONS_JSON_PATH = 'packages/nx-plugin/migrations.json';
const NAME = 'sync-vended-versions';

/** Path the entry points at, relative to `migrations.json`. */
const IMPLEMENTATION = './src/utils/version-upgrade-migration/migration';

/**
 * Register the version sync migration in `migrations.json`, plus the nx
 * `packageJsonUpdates` when an nx package moved. Called by `update-versions.ts`
 * so a bump always ships with the migration that applies it.
 *
 * Every entry points at the same committed `migration.ts`, but each release needs
 * its own: `nx migrate` gates a migration on a concrete version and runs only
 * those above the installed one.
 *
 * Idempotent: re-running before a release claims the entry refreshes it in place.
 *
 * @param nxChanged whether this update bumped any nx package
 * @returns paths written, for the update report
 */
export const registerSyncVersionsMigration = (
  tree: Tree,
  nxChanged: boolean,
): string[] => {
  const migrations: MigrationsJson = JSON.parse(
    tree.read(MIGRATIONS_JSON_PATH, 'utf-8') ?? '{}',
  );

  migrations.generators = {
    ...migrations.generators,
    [migrationKey(LATEST_MIGRATIONS_DIR, NAME)]: {
      description:
        'Sync vended dependency versions and the tracked plugin version to those vended by this release',
      implementation: IMPLEMENTATION,
    },
  };

  // Recorded under `latest` until stamping resolves the version it ships with.
  if (nxChanged) {
    migrations.packageJsonUpdates = {
      ...migrations.packageJsonUpdates,
      ...nxPackageJsonUpdates(LATEST_MIGRATIONS_DIR, LATEST_MIGRATIONS_DIR),
    };
  }

  tree.write(MIGRATIONS_JSON_PATH, `${JSON.stringify(migrations, null, 2)}\n`);

  return [MIGRATIONS_JSON_PATH];
};
