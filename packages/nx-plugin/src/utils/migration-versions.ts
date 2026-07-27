/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { compare, inc } from 'semver';

/**
 * Version stamping for migrations.
 *
 * A new migration is committed with no `version` field — contributors never
 * hand-write one, and the release model never writes one to source (releases
 * are calculated from conventional commits and written only to `dist/` and a
 * git tag). Versions reach the published `migrations.json` two ways:
 *
 * - The weekly `update-versions` PR backfills the version of the release that
 *   shipped each migration, moves it out of `latest/` into that release's
 *   `v<version>/` folder and re-keys it to match, so over time source carries
 *   the versions of everything already released (see
 *   `scripts/backfill-migration-versions.ts`).
 * - At package time, entries still missing a version are stamped into the
 *   compiled `migrations.json` (see `scripts/stamp-migrations.ts`): one that has
 *   already shipped (but isn't backfilled yet) gets the version of the earliest
 *   release tag registering it, and a net-new one gets a version strictly
 *   greater than the latest tag and strictly less than any possible next
 *   release. `nx migrate` runs a migration when `installed < migration.version`,
 *   so any version in that open interval is correct regardless of what the next
 *   release number turns out to be.
 *
 * A version already present in source always wins, so backfilled entries are
 * stable and never recomputed.
 */

export interface MigrationsJson {
  generators?: Record<string, { version?: string } & Record<string, unknown>>;
}

/**
 * Semver comparator suitable for `Array.prototype.sort`, ordering ascending.
 * Re-exported so callers order release tags without importing `semver`
 * directly.
 */
export const compareVersions = compare;

/**
 * Version stamped onto migrations that are not present in any release tag.
 *
 * `semver.inc(latest, 'prerelease')` yields a version that sorts strictly
 * between the latest release and every possible next release:
 * - `1.2.3`       -> `1.2.4-0`      (> 1.2.3, < 1.2.4 / 1.3.0 / 2.0.0)
 * - `1.0.0-rc.32` -> `1.0.0-rc.33`  (> rc.32, < 1.0.0)
 */
export const unshippedMigrationVersion = (latestVersion: string): string => {
  const version = inc(latestVersion, 'prerelease');
  if (!version) {
    throw new Error(`Invalid latest release version: ${latestVersion}`);
  }
  return version;
};

/**
 * Return a copy of the migrations collection with a `version` stamped onto
 * every generator entry. A version already on an entry (backfilled into source
 * by a previous `update-versions` run) is preserved.
 *
 * @param migrations parsed migrations.json to stamp
 * @param shippedVersions migration name -> version of the earliest release
 *   tag that registers it (absent for migrations that haven't shipped)
 * @param latestVersion version of the latest release tag (without the `v`
 *   prefix), used to derive versions for unshipped migrations
 */
export const stampMigrationVersions = (
  migrations: MigrationsJson,
  shippedVersions: Record<string, string>,
  latestVersion: string,
): MigrationsJson => {
  const unshippedVersion = unshippedMigrationVersion(latestVersion);
  return {
    ...migrations,
    generators: Object.fromEntries(
      Object.entries(migrations.generators ?? {}).map(([name, entry]) => [
        name,
        { version: shippedVersions[name] ?? unshippedVersion, ...entry },
      ]),
    ),
  };
};

/** Directory a newly scaffolded migration lands in, before a release claims it. */
export const LATEST_MIGRATIONS_DIR = 'latest';

/** Directory holding the migrations shipped by a given release. */
export const versionMigrationsDir = (version: string) => `v${version}`;

/**
 * Key a migration is registered under in `migrations.json`. Prefixed with the
 * directory the migration lives in so reusing a name in a later release can't
 * silently overwrite the entry (or the files) of the one that already shipped.
 */
export const migrationKey = (dir: string, name: string) => `${dir}-${name}`;

/** Prefix of the key of a migration that no release has claimed yet. */
const LATEST_KEY_PREFIX = `${LATEST_MIGRATIONS_DIR}-`;

/** A migration directory move the caller needs to make on disk. */
export interface MigrationDirMove {
  name: string;
  version: string;
  from: string;
  to: string;
}

/**
 * Return a copy of the migrations collection with the version of the release
 * that shipped each migration written onto entries that don't have one yet, the
 * keys of the entries that changed, and the directory moves that go with them
 * (out of `latest` and into the release's version folder). Entries are re-keyed
 * and their paths re-pointed to match the new folder.
 *
 * Unlike `stampMigrationVersions` this only records versions that are already
 * released — a migration not present in any release tag is left without a
 * version, so the release keeps deciding what a net-new migration gets.
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
  const entries = Object.entries(migrations.generators ?? {});
  const moves: MigrationDirMove[] = [];

  const backfilledEntries = entries.map(([key, entry]) => {
    const version = shippedVersions[key];
    if (entry.version || !version) {
      return [key, entry] as const;
    }
    // Re-key and re-point the entry at the release's version folder, and record
    // the matching directory move for the caller to make.
    const name = key.startsWith(LATEST_KEY_PREFIX)
      ? key.slice(LATEST_KEY_PREFIX.length)
      : key;
    const versionDir = versionMigrationsDir(version);
    const latestSegment = `/${LATEST_MIGRATIONS_DIR}/${name}/`;
    const versionSegment = `/${versionDir}/${name}/`;
    const repointed = Object.fromEntries(
      Object.entries(entry).map(([field, value]) => [
        field,
        typeof value === 'string' && value.includes(latestSegment)
          ? value.replace(latestSegment, versionSegment)
          : value,
      ]),
    );
    const movedPath = Object.values(entry).find(
      (value): value is string =>
        typeof value === 'string' && value.includes(latestSegment),
    );
    if (movedPath) {
      const dir = movedPath.slice(0, movedPath.indexOf(latestSegment));
      moves.push({
        name,
        version,
        from: `${dir}${latestSegment}`.replace(/^\.\/|\/$/g, ''),
        to: `${dir}${versionSegment}`.replace(/^\.\/|\/$/g, ''),
      });
    }
    return [migrationKey(versionDir, name), { version, ...repointed }] as const;
  });

  return {
    migrations: {
      ...migrations,
      generators: Object.fromEntries(backfilledEntries),
    },
    backfilled: entries
      .filter(([key, entry]) => !entry.version && shippedVersions[key])
      .map(([key]) => key),
    moves,
  };
};
