/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Version stamping for migrations.
 *
 * A new migration is committed with no `version` field — contributors never
 * hand-write one. At release time the pending release version is resolved (from
 * `nx release version --dry-run`) and stamped onto every entry still missing
 * one, then committed back to source. Entries that already carry a version were
 * stamped by an earlier release and are left untouched, so a migration never
 * re-runs for users already past the release that shipped it.
 */

export interface MigrationsJson {
  generators?: Record<string, { version?: string } & Record<string, unknown>>;
}

/**
 * Return a copy of the migrations collection with `releaseVersion` stamped onto
 * every entry that has no version yet, and a flag indicating whether anything
 * changed (so the caller can skip an empty commit).
 *
 * @param migrations parsed migrations.json to stamp
 * @param releaseVersion the version about to be released (without a `v` prefix)
 */
export const stampMigrationVersions = (
  migrations: MigrationsJson,
  releaseVersion: string,
): { migrations: MigrationsJson; stamped: string[] } => {
  const stamped = Object.entries(migrations.generators ?? {})
    .filter(([, entry]) => !entry.version)
    .map(([name]) => name);
  return {
    migrations: {
      ...migrations,
      generators: Object.fromEntries(
        Object.entries(migrations.generators ?? {}).map(([name, entry]) => [
          name,
          entry.version ? entry : { version: releaseVersion, ...entry },
        ]),
      ),
    },
    stamped,
  };
};
