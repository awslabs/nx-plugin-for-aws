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
import { assembleMigrations } from '../packages/nx-plugin/src/utils/migration-manifest';
import {
  backfillMigrationVersions,
  readShippedMigrationVersions,
} from '../packages/nx-plugin/src/utils/migration-versions';
import {
  discoverMigrations,
  PACKAGE_JSON_UPDATES_PATH,
  readPackageJsonUpdates,
} from './utils/migration-folders';
import {
  readReleasedMigrations,
  releasedVersionsDescending,
} from './utils/migration-release-tags';

/**
 * Records the release that shipped each migration by moving its folder out of
 * `latest/` into that release's `v<version>/` folder — the folder is where the
 * version now lives, so the assembled `migrations.json` picks it up. Dates any
 * shipped nx bump in `packageJsonUpdates.json` in place. Runs in the weekly
 * `update-versions` workflow, whose PR commits the result, so the release only
 * has to reason about what's still in `latest` (see `utils/migration-versions.ts`
 * for the versioning model).
 *
 * Only already-released migrations are touched — a net-new one stays in `latest`
 * without a version for the release to stamp.
 */

const PLUGIN_ROOT = 'packages/nx-plugin';

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
  const { name } = JSON.parse(
    readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf-8'),
  );
  const migrations = assembleMigrations(
    name,
    discoverMigrations(),
    readPackageJsonUpdates(),
  );

  const versions = releasedVersionsDescending();
  if (versions.length === 0) {
    throw new Error(
      'No release tags found — migration versions cannot be backfilled. Fetch tags (git fetch --tags) and retry.',
    );
  }

  const {
    migrations: backfilledMigrations,
    backfilled,
    moves,
  } = backfillMigrationVersions(
    migrations,
    readShippedMigrationVersions(migrations, versions, readReleasedMigrations),
  );

  if (backfilled.length === 0) {
    console.log(
      'No released migrations missing a version — nothing to backfill.',
    );
    return;
  }

  // The folder is the source of a migration's version, so moving it is what
  // records the release; generation re-derives the entry from the new location.
  for (const move of moves) {
    const from = join(PLUGIN_ROOT, move.from);
    const to = join(PLUGIN_ROOT, move.to);
    if (!existsSync(from)) {
      console.warn(
        `Skipping move for ${move.name}: ${from} not found (already moved?).`,
      );
      continue;
    }
    moveDir(from, to);
    console.log(`Moved ${move.name} to ${move.to}`);
  }

  // Dating an nx bump only changes its `version`, so it is written back to its
  // own committed file rather than the generated manifest.
  if (backfilledMigrations.packageJsonUpdates) {
    writeFileSync(
      PACKAGE_JSON_UPDATES_PATH,
      `${JSON.stringify(backfilledMigrations.packageJsonUpdates, null, 2)}\n`,
      'utf-8',
    );
  }

  console.log(
    `Backfilled ${backfilled.length} migration version(s): ${backfilled.join(', ')}`,
  );
};

main();
