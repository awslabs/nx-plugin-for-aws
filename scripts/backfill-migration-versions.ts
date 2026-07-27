/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
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
 * `migrations.json`, moving it out of `latest/` into that release's `v<version>/`
 * folder and re-keying its entry to match (see `utils/migration-versions.ts`
 * for the versioning model). Runs in the weekly `update-versions` workflow,
 * whose PR commits the result, so the release only has to reason about what's
 * still in `latest`.
 *
 * Only already-released migrations are touched — a net-new one stays in `latest`
 * without a version for the release to stamp.
 */

const MIGRATIONS_ROOT = dirname(SOURCE_MIGRATIONS_PATH);

/** Move a directory, preferring `git mv` so the diff shows a rename. */
const moveDir = (from: string, to: string) => {
  mkdirSync(dirname(to), { recursive: true });
  try {
    execFileSync('git', ['mv', from, to], { stdio: 'ignore' });
  } catch {
    renameSync(from, to);
  }
};

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

  const {
    migrations: backfilledMigrations,
    backfilled,
    moves,
  } = backfillMigrationVersions(migrations, readShippedMigrationVersions(tags));

  if (backfilled.length === 0) {
    console.log(
      `No released migrations missing a version in ${SOURCE_MIGRATIONS_PATH} — nothing to backfill.`,
    );
    return;
  }

  for (const move of moves) {
    const from = join(MIGRATIONS_ROOT, move.from);
    const to = join(MIGRATIONS_ROOT, move.to);
    if (!existsSync(from)) {
      console.warn(
        `Skipping move for ${move.name}: ${from} not found (already moved?).`,
      );
      continue;
    }
    moveDir(from, to);
    console.log(`Moved ${move.name} to ${move.to}`);
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
