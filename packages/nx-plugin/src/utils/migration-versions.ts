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
 *   versions of everything already released. `packageJsonUpdates` entries are
 *   dated in place there too, since their keys never change.
 *
 * A version already in source always wins, so backfilled entries are stable.
 *
 * An entry marked `everyMigration: true` is never backfilled or pinned, and is
 * re-stamped with each pending version, so it runs on every upgrade.
 */

export interface MigrationsJson {
  $schema?: string;
  name?: string;
  generators?: Record<
    string,
    { version?: string; everyMigration?: boolean } & Record<string, unknown>
  >;
  /**
   * Declarative dependency bumps `nx migrate` applies to the root manifest.
   * Keyed by what the bump targets rather than the release that ships it, so an
   * entry is unique from the moment it is written and one release's bump can sit
   * beside the next; nx itself gates on the entry's `version`.
   */
  packageJsonUpdates?: Record<
    string,
    { version: string } & Record<string, unknown>
  >;
}

/** Ascending semver comparator for `Array.prototype.sort`. */
export const compareVersions = compare;

/** Whether a string is an exact semver version. */
export const isValidVersion = (version: string): boolean =>
  valid(version) !== null;

/**
 * Map of entry key -> version of the earliest release that registers it, across
 * both `generators` and `packageJsonUpdates`. Resolved only for the entries still
 * missing a version (one already recorded in source wins, so its history doesn't
 * need reading). An entry that hasn't been released is absent.
 *
 * Walks releases newest first and stops as soon as every entry is resolved: an
 * entry that has disappeared from a release's `migrations.json` was first
 * registered by the release after it, which is the one that shipped it.
 *
 * Both sections resolve the same way and share the walk, so the release doesn't
 * read tag history twice. Keys can't collide: a migration is keyed by its own
 * name, an nx bump by the nx version it moves to.
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
  // A `packageJsonUpdates` entry records `latest` rather than omitting its
  // version, since nx requires the field.
  let unresolved = [
    ...Object.entries(migrations.generators ?? {})
      .filter(([, entry]) => !entry.version)
      .map(([key]) => key),
    ...Object.entries(migrations.packageJsonUpdates ?? {})
      .filter(([, entry]) => entry.version === LATEST_MIGRATIONS_DIR)
      .map(([key]) => key),
  ];

  for (const version of versions) {
    if (unresolved.length === 0) {
      break;
    }
    const released = readReleasedMigrations(version);
    const registered = new Set([
      ...Object.keys(released?.generators ?? {}),
      ...Object.keys(released?.packageJsonUpdates ?? {}),
    ]);
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
 * Rank a migration ships under, lower running first. Unranked entries (no commit
 * history for them, or an every-migration entry with no folder) sort after every
 * ranked one, so a ranked migration always precedes an unranked peer.
 */
const UNRANKED = Number.MAX_SAFE_INTEGER;

/**
 * Return a copy of the migrations collection with a `version` stamped onto
 * every generator entry, preserving any already present, and the pending version
 * recorded on any `packageJsonUpdates` entry still holding `latest`.
 *
 * `nx migrate` sorts the run ascending by version and keeps the manifest's order
 * among equal versions, so the order entries are emitted in is the run order
 * within a release. Migrations sharing a version (a batch shipped together, or a
 * whole `v<x.y.z>` folder replayed on a big version jump) are therefore ordered
 * here by the commit that added them — an earlier-committed migration runs
 * first — so a later migration can depend on an earlier one in the same batch.
 * Every-migration entries are emitted last regardless, so they run after the
 * release's own migrations (letting one add a dependency this then brings up to
 * date). Entries with no rank fall back to the manifest's order, which
 * `assembleMigrations` already sorts by key.
 *
 * @param migrations parsed migrations.json to stamp
 * @param shippedVersions migration key -> version of the earliest release
 *   tag that registers it (absent for migrations that haven't shipped)
 * @param pendingVersion version the release is about to publish, stamped onto
 *   unshipped migrations so their version is one that really shipped
 * @param commitRanks migration key -> rank of the commit that added it (lower is
 *   earlier); absent entries fall back to the manifest's order
 */
export const stampMigrationVersions = (
  migrations: MigrationsJson,
  shippedVersions: Record<string, string>,
  pendingVersion: string,
  commitRanks: Record<string, number> = {},
): MigrationsJson => ({
  ...migrations,
  generators: Object.fromEntries(
    Object.entries(migrations.generators ?? {})
      .sort(([keyA, a], [keyB, b]) => {
        const everyDiff =
          Number(a.everyMigration ?? false) - Number(b.everyMigration ?? false);
        if (everyDiff !== 0) {
          return everyDiff;
        }
        // Equal ranks (same commit, or both unranked) fall through to a stable
        // sort, keeping the manifest's key order the assembly already imposed.
        return (
          (commitRanks[keyA] ?? UNRANKED) - (commitRanks[keyB] ?? UNRANKED)
        );
      })
      .map(([name, entry]) => {
        // Source-only marker, stripped from what nx reads.
        const { everyMigration, version: sourceVersion, ...published } = entry;
        // Overrides any source version so it stays ahead of what is installed.
        const version = everyMigration
          ? pendingVersion
          : (sourceVersion ?? shippedVersions[name] ?? pendingVersion);
        return [name, { version, ...published }];
      }),
  ),
  ...(migrations.packageJsonUpdates && {
    packageJsonUpdates: stampPackageJsonUpdates(
      migrations.packageJsonUpdates,
      pendingVersion,
    ),
  }),
});

/**
 * Version any `packageJsonUpdates` entry still holding `latest` with the release
 * about to publish it, so the nx bump ships under a version `nx migrate` gates on.
 */
const stampPackageJsonUpdates = (
  packageJsonUpdates: NonNullable<MigrationsJson['packageJsonUpdates']>,
  pendingVersion: string,
): NonNullable<MigrationsJson['packageJsonUpdates']> =>
  resolvePackageJsonUpdateVersions(packageJsonUpdates, () => pendingVersion);

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
  // Reported alongside the migrations so the update's PR says an nx bump was
  // dated, and so the caller knows there is something to commit.
  const backfilledUpdates = Object.entries(migrations.packageJsonUpdates ?? {})
    .filter(
      ([key, entry]) =>
        entry.version === LATEST_MIGRATIONS_DIR && shippedVersions[key],
    )
    .map(([key]) => key);

  for (const [key, entry] of Object.entries(migrations.generators ?? {})) {
    const version = shippedVersions[key];
    // Pinning an every-migration entry would stop it running on later upgrades.
    if (entry.version || !version || entry.everyMigration) {
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

  return {
    migrations: {
      ...migrations,
      generators,
      ...(migrations.packageJsonUpdates && {
        packageJsonUpdates: resolvePackageJsonUpdateVersions(
          migrations.packageJsonUpdates,
          (key) => shippedVersions[key],
        ),
      }),
    },
    backfilled: [...backfilled, ...backfilledUpdates],
    moves,
  };
};

/**
 * Record the version each `packageJsonUpdates` entry ships under, for those still
 * holding `latest`.
 *
 * The key already identifies the entry — an nx bump is named for the nx version
 * it moves to — so only the `version` field changes. Nothing is re-keyed, which
 * is what lets one release's bump sit alongside the next without either being
 * overwritten before it ships.
 */
const resolvePackageJsonUpdateVersions = (
  packageJsonUpdates: NonNullable<MigrationsJson['packageJsonUpdates']>,
  resolve: (key: string) => string | undefined,
): NonNullable<MigrationsJson['packageJsonUpdates']> =>
  Object.fromEntries(
    Object.entries(packageJsonUpdates).map(([key, entry]) => {
      const version =
        entry.version === LATEST_MIGRATIONS_DIR ? resolve(key) : undefined;
      return [key, version ? { ...entry, version } : entry];
    }),
  );
