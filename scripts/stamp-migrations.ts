/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  isValidVersion,
  type MigrationsJson,
  stampMigrationVersions,
} from '../packages/nx-plugin/src/utils/migration-versions';
import {
  readShippedMigrationVersions,
  releaseTagsAscending,
  SOURCE_MIGRATIONS_PATH,
} from './utils/migration-release-tags';

/**
 * Stamps versions onto the compiled `migrations.json` (see
 * `utils/migration-versions.ts` for the versioning model).
 *
 * Entries backfilled into source by the weekly `update-versions` PR keep their
 * version. Anything still unversioned is stamped with the pending release
 * version when one is passed (`--pending-version`), and otherwise with a
 * version just above the latest tag.
 *
 * Runs twice on a release: once in the `package` target with no pending version,
 * then again in the release job once `nx release version --dry-run` has resolved
 * the version about to publish. Stamping always derives from *source*
 * `migrations.json`, so the second run replaces the first's fallback rather than
 * compounding it.
 *
 * Usage: tsx scripts/stamp-migrations.ts [--pending-version <x.y.z>]
 */

const DIST_MIGRATIONS_PATH = 'dist/packages/nx-plugin/migrations.json';

/**
 * The release the publish is about to make, resolved by the release job with
 * `nx release version --dry-run` so both runs share one set of flags.
 */
const readPendingVersion = (argv: string[]): string | undefined => {
  const index = argv.indexOf('--pending-version');
  if (index === -1) {
    return undefined;
  }
  const version = argv[index + 1];
  if (!version || version.startsWith('--')) {
    throw new Error('--pending-version requires a version argument');
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

  const tags = releaseTagsAscending();
  if (tags.length === 0) {
    throw new Error(
      'No release tags found — migrations cannot be stamped. Fetch tags (git fetch --tags) and retry.',
    );
  }

  const latestVersion = tags[tags.length - 1].slice(1);
  const stamped = stampMigrationVersions(
    migrations,
    readShippedMigrationVersions(tags),
    latestVersion,
    pendingVersion,
  );

  writeFileSync(
    DIST_MIGRATIONS_PATH,
    `${JSON.stringify(stamped, null, 2)}\n`,
    'utf-8',
  );
  console.log(
    `Stamped ${Object.keys(stamped.generators ?? {}).length} migration(s) into ${DIST_MIGRATIONS_PATH} (${
      pendingVersion
        ? `pending release: ${pendingVersion}`
        : `latest release: ${latestVersion}, no pending release given`
    })`,
  );
};

main();
