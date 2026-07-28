/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { compare, inc, valid } from 'semver';

/**
 * Version stamping for migrations.
 *
 * A new migration is committed with no `version` — releases are calculated from
 * conventional commits and written only to `dist/` and a git tag, so versions
 * reach the published `migrations.json` two ways:
 *
 * - The weekly `update-versions` PR backfills the version of the release that
 *   shipped each migration, moving and re-keying it accordingly
 *   (`scripts/backfill-migration-versions.ts`).
 * - At package time (`scripts/stamp-migrations.ts`) entries still missing a
 *   version are stamped into the compiled `migrations.json`: an already shipped
 *   one gets the earliest release tag registering it, and a net-new one gets the
 *   version the release is about to publish, which the release job passes in
 *   after `nx release version` writes it to the dist manifests.
 *
 * When no pending version is supplied (packaging locally or on a PR, where no
 * release follows) a net-new migration falls back to a version strictly between
 * the latest tag and any possible next release. `nx migrate` runs a migration
 * when `installed < migration.version`, so that interval is always correct — it
 * just isn't a version that was really published, which is why the release
 * itself passes the real one.
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
 * Fallback version for a migration that hasn't shipped, used when the release
 * about to publish is unknown (see the module comment).
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
 * every generator entry, preserving any already present.
 *
 * @param migrations parsed migrations.json to stamp
 * @param shippedVersions migration key -> version of the earliest release
 *   tag that registers it (absent for migrations that haven't shipped)
 * @param latestVersion version of the latest release tag (without the `v`
 *   prefix), used to derive a version for unshipped migrations when no
 *   `pendingVersion` is given
 * @param pendingVersion version the release is about to publish, stamped onto
 *   unshipped migrations so their version is one that really shipped
 */
export const stampMigrationVersions = (
  migrations: MigrationsJson,
  shippedVersions: Record<string, string>,
  latestVersion: string,
  pendingVersion?: string,
): MigrationsJson => {
  const unshippedVersion =
    pendingVersion ?? unshippedMigrationVersion(latestVersion);
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
  const entries = Object.entries(migrations.generators ?? {});
  const moves: MigrationDirMove[] = [];

  const backfilledEntries = entries.map(([key, entry]) => {
    const version = shippedVersions[key];
    if (entry.version || !version) {
      return [key, entry] as const;
    }
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
