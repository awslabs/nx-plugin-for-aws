/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  compareVersions,
  LATEST_MIGRATIONS_DIR,
} from '../../../packages/nx-plugin/src/utils/migration-versions';

/**
 * Build-time discovery of the plugin's migrations for the migrations reference
 * page. Reads the same source of truth `migrations.json` is assembled from — one
 * folder per migration under `src/migrations/<dir>/<name>/` — so the page can't
 * drift from what actually ships.
 *
 * Run order is read straight off the tree: releases sort by semver, and within a
 * release the zero-padded `NNNN-` prefix the backfill beds into each folder name
 * gives the order that release ran them.
 */

/** Where the migration folders live, relative to the repository root. */
const MIGRATIONS_DIR = 'packages/nx-plugin/src/migrations';

/** How a migration is applied, discriminated by the files in its folder. */
export type MigrationKind = 'deterministic' | 'agentic' | 'hybrid';

/** A single migration, as the reference page presents it. */
export interface MigrationEntry {
  /** Migration name, without the order prefix its folder may carry. */
  name: string;
  /** Description `nx migrate` prints when the migration runs. */
  description: string;
  kind: MigrationKind;
  /** Position within its release, or undefined while the order is unsettled. */
  order?: number;
}

/** The migrations shipped by one release, in the order that release ran them. */
export interface MigrationRelease {
  /** Release version, or undefined for migrations that haven't shipped yet. */
  version?: string;
  migrations: MigrationEntry[];
}

/** Leading `NNNN-` order prefix a released migration's folder carries. */
const ORDER_PREFIX = /^(\d{4})-/;

/** Split a migration folder name into its bedded-in order and its name. */
const parseFolderName = (
  folderName: string,
): { name: string; order?: number } => {
  const match = folderName.match(ORDER_PREFIX);
  return match
    ? { name: folderName.slice(match[0].length), order: Number(match[1]) }
    : { name: folderName };
};

/**
 * Path to the migration folders. The working directory is `docs` under `astro
 * build` and `astro dev` but the repository root elsewhere, so try both — this
 * can't be anchored on the module's own location, which moves when Astro bundles
 * it.
 */
export const MIGRATIONS_PATH =
  [MIGRATIONS_DIR, join('..', MIGRATIONS_DIR)].find((candidate) =>
    existsSync(candidate),
  ) ?? MIGRATIONS_DIR;

/**
 * Read every migration in the tree, grouped by the release that shipped it,
 * newest release first with the unreleased ones ahead of them.
 */
export const readMigrationReleases = (): MigrationRelease[] => {
  const migrationsDir = MIGRATIONS_PATH;
  if (!existsSync(migrationsDir)) {
    return [];
  }

  const releases: MigrationRelease[] = [];
  let unreleased: MigrationEntry[] = [];

  for (const dir of readdirSync(migrationsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) {
      continue;
    }
    const groupDir = join(migrationsDir, dir.name);
    const migrations: MigrationEntry[] = [];

    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const migrationDir = join(groupDir, entry.name);
      const metadataPath = join(migrationDir, 'metadata.json');
      if (!existsSync(metadataPath)) {
        continue;
      }
      const { description } = JSON.parse(readFileSync(metadataPath, 'utf-8'));
      const hasImplementation = existsSync(join(migrationDir, 'migration.ts'));
      const hasPrompt = existsSync(join(migrationDir, 'prompt.md'));
      const { name, order } = parseFolderName(entry.name);
      migrations.push({
        name,
        description,
        order,
        kind:
          hasImplementation && hasPrompt
            ? 'hybrid'
            : hasPrompt
              ? 'agentic'
              : 'deterministic',
      });
    }

    if (dir.name === LATEST_MIGRATIONS_DIR) {
      // Unreleased, so no order is settled yet — the release resolves it from
      // commit history.
      unreleased = migrations.sort((a, b) => a.name.localeCompare(b.name));
      continue;
    }
    releases.push({
      version: dir.name.replace(/^v/, ''),
      // The order prefix alone sorts a release's migrations into run order.
      migrations: migrations.sort(
        (a, b) =>
          (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name),
      ),
    });
  }

  releases.sort((a, b) => compareVersions(b.version!, a.version!));
  return [
    ...(unreleased.length > 0 ? [{ migrations: unreleased }] : []),
    ...releases,
  ];
};
