/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
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
 * `utils/migration-versions.ts` for the versioning model). Runs as part of
 * the nx-plugin `package` target, after `compile` populates dist.
 *
 * Entries whose version was backfilled into source by the weekly
 * `update-versions` PR keep it; the rest are resolved from release tags here.
 */

const DIST_MIGRATIONS_PATH = 'dist/packages/nx-plugin/migrations.json';

const main = () => {
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
  );

  writeFileSync(
    DIST_MIGRATIONS_PATH,
    `${JSON.stringify(stamped, null, 2)}\n`,
    'utf-8',
  );
  console.log(
    `Stamped ${Object.keys(stamped.generators ?? {}).length} migration(s) into ${DIST_MIGRATIONS_PATH} (latest release: ${latestVersion})`,
  );
};

main();
