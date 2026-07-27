/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  backfillMigrationVersions,
  type MigrationsJson,
} from '../packages/nx-plugin/src/utils/migration-versions';
import {
  readShippedMigrationVersions,
  releaseTagsAscending,
  SOURCE_MIGRATIONS_PATH,
} from './utils/migration-release-tags';

/**
 * Records the release that shipped each migration in the source
 * `migrations.json` (see `utils/migration-versions.ts` for the versioning
 * model). Runs in the weekly `update-versions` workflow, whose PR commits the
 * result, so source converges on the versions of everything already released
 * and the release only has to reason about entries that are still unversioned.
 *
 * Only already-released migrations are written. A net-new migration is left
 * without a version for the release to stamp.
 */

const main = () => {
  const migrations: MigrationsJson = JSON.parse(
    readFileSync(SOURCE_MIGRATIONS_PATH, 'utf-8'),
  );

  const tags = releaseTagsAscending();
  if (tags.length === 0) {
    throw new Error(
      'No release tags found — migration versions cannot be backfilled. Fetch tags (git fetch --tags) and retry.',
    );
  }

  const { migrations: backfilledMigrations, backfilled } =
    backfillMigrationVersions(migrations, readShippedMigrationVersions(tags));

  if (backfilled.length === 0) {
    console.log(
      `No released migrations missing a version in ${SOURCE_MIGRATIONS_PATH} — nothing to backfill.`,
    );
    return;
  }

  writeFileSync(
    SOURCE_MIGRATIONS_PATH,
    `${JSON.stringify(backfilledMigrations, null, 2)}\n`,
    'utf-8',
  );
  console.log(
    `Backfilled ${backfilled.length} migration version(s) in ${SOURCE_MIGRATIONS_PATH}: ${backfilled.join(', ')}`,
  );
};

main();
