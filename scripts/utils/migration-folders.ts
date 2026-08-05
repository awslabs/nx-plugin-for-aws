/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DiscoveredMigration } from '../../packages/nx-plugin/src/utils/migration-manifest';
import type { MigrationsJson } from '../../packages/nx-plugin/src/utils/migration-versions';

/**
 * Filesystem discovery of the pieces `migrations.json` is assembled from. The
 * assembly itself is pure (`src/utils/migration-manifest.ts`); this is the IO
 * that feeds it, shared by the generate, stamp and backfill scripts.
 */

/** Where the migration folders live, relative to the plugin package root. */
export const MIGRATIONS_DIR = 'packages/nx-plugin/src/migrations';

/** The nx bumps the weekly update maintains, kept out of the manifest source. */
export const PACKAGE_JSON_UPDATES_PATH =
  'packages/nx-plugin/packageJsonUpdates.json';

/**
 * Walk `src/migrations`, returning a folder per migration. Grouping folders
 * (`latest`, `v<version>`) hold one subfolder per migration; the migration's
 * kind is read from the files present.
 */
export const discoverMigrations = (
  migrationsDir: string = MIGRATIONS_DIR,
): DiscoveredMigration[] => {
  if (!existsSync(migrationsDir)) {
    return [];
  }
  const migrations: DiscoveredMigration[] = [];
  for (const dir of readdirSync(migrationsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) {
      continue;
    }
    const groupDir = join(migrationsDir, dir.name);
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const migrationDir = join(groupDir, entry.name);
      const metadataPath = join(migrationDir, 'metadata.json');
      if (!existsSync(metadataPath)) {
        throw new Error(
          `Migration ${dir.name}/${entry.name} is missing metadata.json`,
        );
      }
      const { description } = JSON.parse(readFileSync(metadataPath, 'utf-8'));
      migrations.push({
        dir: dir.name,
        name: entry.name,
        description,
        hasImplementation: existsSync(join(migrationDir, 'migration.ts')),
        hasPrompt: existsSync(join(migrationDir, 'prompt.md')),
      });
    }
  }
  return migrations;
};

/** Read `packageJsonUpdates.json`, or undefined when absent. */
export const readPackageJsonUpdates = (
  path: string = PACKAGE_JSON_UPDATES_PATH,
): MigrationsJson['packageJsonUpdates'] =>
  existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : undefined;
