/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { compare, valid } from 'semver';

/**
 * Version stamping for migrations.
 *
 * A new migration is committed with no `version` — releases are calculated from
 * conventional commits and written only to `dist/` and a git tag, so versions
 * reach the published `migrations.json` two ways:
 *
 * - At release time (`scripts/stamp-migrations.ts`) entries still missing a
 *   version are stamped into the compiled `migrations.json`: an already shipped
 *   one gets the earliest release tag registering it, and a net-new one gets the
 *   version the release is about to publish, which the release job passes in
 *   after `nx release version` writes it to the dist manifests.
 * - The weekly `update-versions` PR backfills the version of the release that
 *   shipped each migration, moving and re-keying it accordingly
 *   (`scripts/backfill-migration-versions.ts`), so source converges on the
 *   versions of everything already released.
 *
 * A version already in source always wins, so backfilled entries are stable.
 */

export interface MigrationsJson {
  generators?: Record<string, { version?: string } & Record<string, unknown>>;
}

/** Ascending semver comparator for `Array.prototype.sort`. */
export const compareVersions = compare;

/** Whether a string is an exact semver version. */
export const isValidVersion = (version: string): boolean =>
  valid(version) !== null;

/**
 * Map of migration key -> version of the earliest release that registers it,
 * resolved only for the entries still missing a `version` (one already recorded
 * in source wins, so its history doesn't need reading). A migration that hasn't
 * been released is absent.
 *
 * Walks releases newest first and stops as soon as every entry is resolved: an
 * entry that has disappeared from a release's `migrations.json` was first
 * registered by the release after it, which is the one that shipped it.
 *
 * @param migrations parsed source migrations.json
 * @param versions released versions in descending semver order
 * @param readReleasedMigrations reads the `migrations.json` published by a given
 *   version, or undefined if it predates the manifest
 */
export const readShippedMigrationVersions = (
  migrations: MigrationsJson,
  versions: string[],
  readReleasedMigrations: (version: string) => MigrationsJson | undefined,
): Record<string, string> => {
  const shippedVersions: Record<string, string> = {};
  let unresolved = Object.entries(migrations.generators ?? {})
    .filter(([, entry]) => !entry.version)
    .map(([key]) => key);

  for (const version of versions) {
    if (unresolved.length === 0) {
      break;
    }
    const registered = new Set(
      Object.keys(readReleasedMigrations(version)?.generators ?? {}),
    );
    // Entries gone at this release keep the version recorded from the release
    // after it (if any) and stop being looked up.
    unresolved = unresolved.filter((key) => registered.has(key));
    for (const key of unresolved) {
      shippedVersions[key] = version;
    }
  }

  return shippedVersions;
};

/**
 * Return a copy of the migrations collection with a `version` stamped onto
 * every generator entry, preserving any already present.
 *
 * @param migrations parsed migrations.json to stamp
 * @param shippedVersions migration key -> version of the earliest release
 *   tag that registers it (absent for migrations that haven't shipped)
 * @param pendingVersion version the release is about to publish, stamped onto
 *   unshipped migrations so their version is one that really shipped
 */
export const stampMigrationVersions = (
  migrations: MigrationsJson,
  shippedVersions: Record<string, string>,
  pendingVersion: string,
): MigrationsJson => ({
  ...migrations,
  generators: Object.fromEntries(
    Object.entries(migrations.generators ?? {}).map(([name, entry]) => [
      name,
      { version: shippedVersions[name] ?? pendingVersion, ...entry },
    ]),
  ),
});

/** Directory a newly scaffolded migration lands in, before a release claims it. */
export const LATEST_MIGRATIONS_DIR = 'latest';

/** Directory holding the migrations shipped by a given release. */
export const versionMigrationsDir = (version: string) => `v${version}`;

/**
 * Key a migration is registered under in `migrations.json`. Prefixed with its
 * directory so reusing a name in a later release can't silently overwrite the
 * one that already shipped.
 */
export const migrationKey = (dir: string, name: string) => `${dir}-${name}`;

const LATEST_KEY_PREFIX = `${LATEST_MIGRATIONS_DIR}-`;

/** A migration directory move the caller needs to make on disk. */
export interface MigrationDirMove {
  name: string;
  version: string;
  from: string;
  to: string;
}

/**
 * Record the release that shipped each migration on entries without a version,
 * re-keying them and re-pointing their paths at that release's folder, and
 * return the collection alongside the keys that changed and the directory moves
 * to make on disk.
 *
 * Unlike `stampMigrationVersions` this only records already-released versions,
 * leaving the release to decide what a net-new migration gets.
 *
 * @param migrations parsed migrations.json to backfill
 * @param shippedVersions migration key -> version of the earliest release tag
 *   that registers it (absent for migrations that haven't shipped)
 */
export const backfillMigrationVersions = (
  migrations: MigrationsJson,
  shippedVersions: Record<string, string>,
): {
  migrations: MigrationsJson;
  backfilled: string[];
  moves: MigrationDirMove[];
} => {
  const generators: NonNullable<MigrationsJson['generators']> = {};
  const backfilled: string[] = [];
  const moves: MigrationDirMove[] = [];

  for (const [key, entry] of Object.entries(migrations.generators ?? {})) {
    const version = shippedVersions[key];
    if (entry.version || !version) {
      generators[key] = entry;
      continue;
    }

    const name = key.startsWith(LATEST_KEY_PREFIX)
      ? key.slice(LATEST_KEY_PREFIX.length)
      : key;
    const versionDir = versionMigrationsDir(version);
    const latestSegment = `/${LATEST_MIGRATIONS_DIR}/${name}/`;
    const versionSegment = `/${versionDir}/${name}/`;

    // Re-point each path field at the version folder, recording the move the
    // caller needs to make on disk the first time one is found.
    const repointed: Record<string, unknown> = {};
    let moved = false;
    for (const [field, value] of Object.entries(entry)) {
      if (typeof value !== 'string' || !value.includes(latestSegment)) {
        repointed[field] = value;
        continue;
      }
      repointed[field] = value.replace(latestSegment, versionSegment);
      if (!moved) {
        moved = true;
        const dir = value.slice(0, value.indexOf(latestSegment));
        moves.push({
          name,
          version,
          from: `${dir}${latestSegment}`.replace(/^\.\/|\/$/g, ''),
          to: `${dir}${versionSegment}`.replace(/^\.\/|\/$/g, ''),
        });
      }
    }

    generators[migrationKey(versionDir, name)] = { version, ...repointed };
    backfilled.push(key);
  }

  return { migrations: { ...migrations, generators }, backfilled, moves };
};
