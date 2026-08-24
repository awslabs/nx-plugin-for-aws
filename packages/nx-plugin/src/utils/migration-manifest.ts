/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { MigrationsJson } from './migration-versions.js';
import {
  isValidVersion,
  LATEST_MIGRATIONS_DIR,
  migrationKey,
} from './migration-versions.js';
import { sortObjectKeys } from './object.js';

/**
 * `migrations.json` is assembled from the plugin's source rather than committed,
 * so two PRs each adding a migration touch disjoint files and never conflict on
 * a shared manifest.
 *
 * The pieces it is assembled from:
 * - one folder per migration under `src/migrations/<dir>/<name>/`, where `<dir>`
 *   is `latest` until a release claims it and `v<version>` after — the folder
 *   carries a `metadata.json` (its description) beside the code, and its files
 *   discriminate the kind: a `migration.ts` makes it deterministic, a `prompt.md`
 *   agentic, both hybrid;
 * - `packageJsonUpdates.json`, the nx bumps the weekly update maintains, kept in
 *   its own file so that churn never shares an edit with a migration PR;
 * - the version sync entry, a fixed `everyMigration` codemod that runs on every
 *   upgrade and so has no folder.
 *
 * The assembled manifest is unversioned — release-time stamping resolves versions
 * (see `migration-versions.ts`).
 */

/** JSON schema the manifest declares, matching what nx expects. */
export const MIGRATIONS_JSON_SCHEMA = 'http://json-schema.org/schema';

/** Key the version sync migration is registered under. */
export const SYNC_VENDED_MIGRATION_KEY = 'sync-vended-versions';

/**
 * The version sync migration entry. Committed as code rather than a folder: it
 * carries no release-specific registration and must run on every upgrade, so it
 * is fixed and can't conflict.
 */
export const syncVendedMigrationEntry = (): NonNullable<
  MigrationsJson['generators']
>[string] => ({
  description:
    'Sync vended dependency versions and the tracked plugin version to those vended by this release',
  implementation: './src/utils/version-upgrade-migration/migration',
  everyMigration: true,
});

/** A migration folder discovered under `src/migrations`. */
export interface DiscoveredMigration {
  /** Folder grouping the migration by release: `latest` or `v<version>`. */
  dir: string;
  /** Migration folder name. */
  name: string;
  /** Description read from the folder's `metadata.json`. */
  description: string;
  /** A `migration.ts` is present, so the migration has a codemod. */
  hasImplementation: boolean;
  /** A `prompt.md` is present, so the migration hands off to an agent. */
  hasPrompt: boolean;
}

/** Registration for a single discovered migration folder. */
const migrationEntry = (
  migration: DiscoveredMigration,
): NonNullable<MigrationsJson['generators']>[string] => {
  const path = `./src/migrations/${migration.dir}/${migration.name}`;
  return {
    // A migration in a `v<version>` folder has already been claimed by that
    // release; its version is the folder. One in `latest` is left for stamping.
    ...(migration.dir !== LATEST_MIGRATIONS_DIR &&
    isValidVersion(migration.dir.replace(/^v/, ''))
      ? { version: migration.dir.replace(/^v/, '') }
      : {}),
    description: migration.description,
    ...(migration.hasImplementation
      ? { implementation: `${path}/migration` }
      : {}),
    ...(migration.hasPrompt ? { prompt: `${path}/prompt.md` } : {}),
  };
};

/**
 * Assemble the plugin's `migrations.json` from its source pieces: the discovered
 * migration folders, the version sync entry, and the nx `packageJsonUpdates`.
 *
 * Deterministic — keys are sorted — so regenerating always yields the same file.
 *
 * @param pluginName the plugin package name the manifest is for
 * @param migrations migration folders discovered under `src/migrations`
 * @param packageJsonUpdates parsed `packageJsonUpdates.json`, if present
 */
export const assembleMigrations = (
  pluginName: string,
  migrations: DiscoveredMigration[],
  packageJsonUpdates?: MigrationsJson['packageJsonUpdates'],
): MigrationsJson => ({
  $schema: MIGRATIONS_JSON_SCHEMA,
  name: pluginName,
  generators: sortObjectKeys({
    [SYNC_VENDED_MIGRATION_KEY]: syncVendedMigrationEntry(),
    ...Object.fromEntries(
      migrations.map((migration) => [
        migrationKey(migration.dir, migration.name),
        migrationEntry(migration),
      ]),
    ),
  }),
  ...(packageJsonUpdates && Object.keys(packageJsonUpdates).length > 0
    ? { packageJsonUpdates }
    : {}),
});
