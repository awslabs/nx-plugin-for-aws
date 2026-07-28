/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  isValidVersion,
  type MigrationsJson,
  readShippedMigrationVersions,
  stampMigrationVersions,
} from '../packages/nx-plugin/src/utils/migration-versions';
import {
  readReleasedMigrations,
  releasedVersionsDescending,
  SOURCE_MIGRATIONS_PATH,
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
 * about to publish into the dist manifests, and stamps from *source*
 * `migrations.json` so it is safe to re-run.
 *
 * Usage: tsx scripts/stamp-migrations.ts --pending-version <x.y.z>
 */

const DIST_MIGRATIONS_PATH = 'dist/packages/nx-plugin/migrations.json';

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
  const pendingVersion = readPendingVersion(process.argv.slice(2));

  const migrations: MigrationsJson = JSON.parse(
    readFileSync(SOURCE_MIGRATIONS_PATH, 'utf-8'),
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
  );

  writeFileSync(
    DIST_MIGRATIONS_PATH,
    `${JSON.stringify(stamped, null, 2)}\n`,
    'utf-8',
  );
  console.log(
    `Stamped ${Object.keys(stamped.generators ?? {}).length} migration(s) into ${DIST_MIGRATIONS_PATH} (pending release: ${pendingVersion})`,
  );
};

main();
