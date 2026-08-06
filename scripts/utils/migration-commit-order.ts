/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { DiscoveredMigration } from '../../packages/nx-plugin/src/utils/migration-manifest';
import { migrationKey } from '../../packages/nx-plugin/src/utils/migration-versions';
import { MIGRATIONS_DIR } from './migration-folders';

/**
 * Resolves the commit order of the migration folders, so release-time stamping
 * can order migrations sharing a version by when they were committed (see
 * `migration-versions.ts` for how that order becomes the `nx migrate` run order).
 *
 * `main` is linear (the repo squash- and rebase-merges), so a migration's rank
 * is the position on `main` of the commit that first added its folder. A later
 * `git mv` into a `v<x.y.z>` folder at release time doesn't reset that — `git log
 * --follow` walks through the rename back to the original add — so a migration
 * keeps its rank once a release claims it.
 *
 * Requires full history; the release job and the migrate smoke test that call
 * the stamping script both check out `fetch-depth: 0`.
 */

/** Run a git command from the repo root, returning trimmed stdout or undefined. */
const tryGit = (args: string[]): string | undefined => {
  try {
    return execFileSync('git', args, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
};

/**
 * The commit that first added a path, following it through renames. `git log`
 * lists newest first and `--follow` is incompatible with `--reverse`, so the
 * oldest (the add) is the last line.
 */
const addCommit = (path: string): string | undefined => {
  const log = tryGit([
    'log',
    '--follow',
    '--diff-filter=A',
    '--format=%H',
    '--',
    path,
  ]);
  if (!log) {
    return undefined;
  }
  const commits = log.split('\n').filter(Boolean);
  return commits[commits.length - 1];
};

/** Position of a commit on the current linear branch (older commits rank lower). */
const commitRank = (commit: string): number | undefined => {
  const count = tryGit(['rev-list', '--count', commit]);
  return count ? Number(count) : undefined;
};

/**
 * Map of migration key -> rank of the commit that added its folder, for the
 * migrations that resolve to one. A migration with no history (unlikely outside
 * a shallow checkout) is absent, and stamping falls back to the manifest order
 * for it.
 *
 * @param migrations migration folders discovered under `src/migrations`
 * @param migrationsDir where those folders live, relative to the repo root
 */
export const readMigrationCommitRanks = (
  migrations: DiscoveredMigration[],
  migrationsDir: string = MIGRATIONS_DIR,
): Record<string, number> => {
  const ranks: Record<string, number> = {};
  for (const migration of migrations) {
    // metadata.json is present for every migration and moves with the folder,
    // so it is a stable anchor for the folder's history across the release move.
    const metadataPath = join(
      migrationsDir,
      migration.dir,
      migration.name,
      'metadata.json',
    );
    const commit = addCommit(metadataPath);
    const rank = commit ? commitRank(commit) : undefined;
    if (rank !== undefined) {
      ranks[migrationKey(migration.dir, migration.name)] = rank;
    }
  }
  return ranks;
};
