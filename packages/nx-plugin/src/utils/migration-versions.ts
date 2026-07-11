/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { compare, inc } from 'semver';

/**
 * Version stamping for migrations.
 *
 * Source `migrations.json` entries carry no `version` field — the release
 * model never commits a version to source (releases are calculated from
 * conventional commits and written only to `dist/` and a git tag). Versions
 * are stamped into the compiled `migrations.json` at package time:
 *
 * - A migration that already shipped is stamped with the version of the
 *   earliest release tag whose `migrations.json` registers it, so it never
 *   re-runs for users already past that release.
 * - A migration that hasn't shipped yet is stamped with a version strictly
 *   greater than the latest tag and strictly less than any possible next
 *   release, so it runs for every user upgrading from any released version.
 *   `nx migrate` runs a migration when `installed < migration.version`, so
 *   any version in that open interval is correct regardless of what the next
 *   release number turns out to be.
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
 * every generator entry.
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
