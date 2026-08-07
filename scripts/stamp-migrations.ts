/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { assembleMigrations } from '../packages/nx-plugin/src/utils/migration-manifest';
import {
  isValidVersion,
  readShippedMigrationVersions,
  stampMigrationVersions,
} from '../packages/nx-plugin/src/utils/migration-versions';
import { readMigrationCommitRanks } from './utils/migration-commit-order';
import {
  discoverMigrations,
  readPackageJsonUpdates,
} from './utils/migration-folders';
import {
  readReleasedMigrations,
  releasedVersionsDescending,
} from './utils/migration-release-tags';

/**
 * Stamps versions onto the compiled `migrations.json` (see
 * `utils/migration-versions.ts` for the versioning model).
 *
 * Entries backfilled into source by the weekly `update-versions` PR keep their
 * version. Anything still unversioned is stamped with the pending release
 * version.
 *
 * Runs in the release job once `nx release version` has written the version
 * about to publish into the dist manifests, and stamps a manifest assembled
 * from source (the migration folders and `packageJsonUpdates.json`) so it is
 * safe to re-run. The release script (`scripts/release.ts`) calls
 * `stampMigrationsFile` directly; this file is also a CLI for the migrate smoke
 * test, which stamps a staging copy via `--out`.
 *
 * Usage: tsx scripts/stamp-migrations.ts --pending-version <x.y.z> [--out <path>]
 *
 * `--out` writes elsewhere than the dist manifest — used by the migrate smoke
 * test, which stamps into a staging copy it publishes at a synthetic version.
 */

export const DIST_MIGRATIONS_PATH = 'dist/packages/nx-plugin/migrations.json';

/**
 * Assemble the plugin's migrations from source, stamp them with the pending
 * release version, and write the result. Shared by the CLI below and the release
 * script so neither shells out to the other.
 *
 * @param pendingVersion the version the release is about to publish
 * @param outPath where to write the stamped manifest (defaults to the dist one)
 * @returns the number of migration entries stamped
 */
export const stampMigrationsFile = (
  pendingVersion: string,
  outPath: string = DIST_MIGRATIONS_PATH,
): number => {
  if (!isValidVersion(pendingVersion)) {
    throw new Error(`pending version is not a valid semver: ${pendingVersion}`);
  }
  const { name } = JSON.parse(
    readFileSync('packages/nx-plugin/package.json', 'utf-8'),
  );
  const discovered = discoverMigrations();
  const migrations = assembleMigrations(
    name,
    discovered,
    readPackageJsonUpdates(),
  );

  const versions = releasedVersionsDescending();
  if (versions.length === 0) {
    throw new Error(
      'No release tags found — migrations cannot be stamped. Fetch tags (git fetch --tags) and retry.',
    );
  }

  const stamped = stampMigrationVersions(
    migrations,
    readShippedMigrationVersions(migrations, versions, readReleasedMigrations),
    pendingVersion,
    // Order migrations sharing a version by the commit that added them, so an
    // earlier-committed one runs first and a later one in the same batch can
    // depend on it.
    readMigrationCommitRanks(discovered),
  );

  writeFileSync(outPath, `${JSON.stringify(stamped, null, 2)}\n`, 'utf-8');
  return Object.keys(stamped.generators ?? {}).length;
};

/** Optional destination override for the stamped manifest. */
const readOutPath = (argv: string[]): string => {
  const index = argv.indexOf('--out');
  if (index === -1) {
    return DIST_MIGRATIONS_PATH;
  }
  const out = argv[index + 1];
  if (!out || out.startsWith('--')) {
    throw new Error('--out requires a path');
  }
  return out;
};

/**
 * The release the publish is about to make, which the release job reads out of
 * the dist manifest `nx release version` just wrote.
 */
const readPendingVersion = (argv: string[]): string => {
  const index = argv.indexOf('--pending-version');
  const version = index === -1 ? undefined : argv[index + 1];
  if (!version || version.startsWith('--')) {
    throw new Error(
      'Usage: tsx scripts/stamp-migrations.ts --pending-version <x.y.z>',
    );
  }
  if (!isValidVersion(version)) {
    throw new Error(`--pending-version is not a valid semver: ${version}`);
  }
  return version;
};

const main = () => {
  const argv = process.argv.slice(2);
  const pendingVersion = readPendingVersion(argv);
  const outPath = readOutPath(argv);
  const count = stampMigrationsFile(pendingVersion, outPath);
  console.log(
    `Stamped ${count} migration(s) into ${outPath} (pending release: ${pendingVersion})`,
  );
};

// Run as a CLI, but not when imported (the release script imports the function).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
