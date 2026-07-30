/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import {
  LATEST_MIGRATIONS_DIR,
  type MigrationsJson,
} from '../migration-versions';
import { nxPackageJsonUpdates } from './nx-package-updates';

const MIGRATIONS_JSON_PATH = 'packages/nx-plugin/migrations.json';

/**
 * Register the nx bump a version update needs, in `migrations.json`.
 *
 * The version sync migration itself is a committed `everyMigration` entry, so
 * only the nx packages need registering per update: they go through
 * `packageJsonUpdates` rather than a migration (see `nx-package-updates.ts`).
 *
 * Idempotent: re-running before a release claims the entry refreshes it in place.
 *
 * @param nxChanged whether this update bumped any nx package
 * @returns paths written, for the update report
 */
export const registerNxPackageUpdates = (
  tree: Tree,
  nxChanged: boolean,
): string[] => {
  if (!nxChanged) {
    return [];
  }

  const migrations: MigrationsJson = JSON.parse(
    tree.read(MIGRATIONS_JSON_PATH, 'utf-8') ?? '{}',
  );

  // Recorded under `latest` until stamping resolves the version it ships with.
  migrations.packageJsonUpdates = {
    ...migrations.packageJsonUpdates,
    ...nxPackageJsonUpdates(LATEST_MIGRATIONS_DIR, LATEST_MIGRATIONS_DIR),
  };

  tree.write(MIGRATIONS_JSON_PATH, `${JSON.stringify(migrations, null, 2)}\n`);

  return [MIGRATIONS_JSON_PATH];
};
