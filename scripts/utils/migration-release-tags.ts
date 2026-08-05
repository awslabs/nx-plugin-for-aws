/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execSync } from 'node:child_process';
import {
  compareVersions,
  type MigrationsJson,
  migrationKey,
} from '../../packages/nx-plugin/src/utils/migration-versions';
import { MIGRATIONS_DIR, PACKAGE_JSON_UPDATES_PATH } from './migration-folders';

/**
 * Reads which migrations each release registered, for
 * `readShippedMigrationVersions`. Shared by the release-time stamping script and
 * the weekly backfill script.
 *
 * `readShippedMigrationVersions` consults only the *keys* a release registered,
 * so this returns a keys-only manifest. Newer releases no longer commit
 * `migrations.json` (it is assembled at build time), so the keys are derived
 * from the migration folders in the tag's tree. Releases predating the split
 * still carry the committed manifest and are read from it, keeping the whole
 * history resolvable across the transition.
 */

/** The committed manifest, present only in releases predating the split. */
const LEGACY_MIGRATIONS_PATH = 'packages/nx-plugin/migrations.json';

/** Released versions (from `v*` tags) in descending semver order. */
export const releasedVersionsDescending = (): string[] =>
  execSync("git tag -l 'v*'", { encoding: 'utf-8' })
    .split('\n')
    .filter(Boolean)
    .map((tag) => tag.slice(1))
    .sort((a, b) => compareVersions(b, a));

/** Run a git command, returning its stdout or undefined when it fails. */
const tryGit = (args: string): string | undefined => {
  try {
    return execSync(`git ${args}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
  } catch {
    return undefined;
  }
};

/** Generator keys derived from the migration folders in a tag's tree. */
const generatorKeysFromTree = (version: string): string[] => {
  const listing = tryGit(
    `ls-tree -r --name-only v${version} ${MIGRATIONS_DIR}/`,
  );
  if (!listing) {
    return [];
  }
  const keys = new Set<string>();
  for (const path of listing.split('\n').filter(Boolean)) {
    // `<MIGRATIONS_DIR>/<group>/<name>/<file>`
    const rest = path.slice(MIGRATIONS_DIR.length + 1).split('/');
    if (rest.length < 3) {
      continue;
    }
    keys.add(migrationKey(rest[0], rest[1]));
  }
  return [...keys];
};

/** Keys parsed from a JSON object at a tag, or none when the path is absent. */
const objectKeysAtTag = (version: string, path: string): string[] => {
  const raw = tryGit(`show v${version}:${path}`);
  return raw ? Object.keys(JSON.parse(raw)) : [];
};

/**
 * The migrations a release registered, as a keys-only manifest. Unions the
 * migration folders in the tag's tree with the committed `migrations.json` of
 * releases predating the assembled manifest, and the nx bumps from whichever of
 * `packageJsonUpdates.json` or that committed manifest the tag carries — so the
 * whole history resolves across the split. Undefined when a release predates
 * migrations entirely.
 */
export const readReleasedMigrations = (
  version: string,
): MigrationsJson | undefined => {
  const legacyRaw = tryGit(`show v${version}:${LEGACY_MIGRATIONS_PATH}`);
  const legacy: MigrationsJson | undefined = legacyRaw
    ? JSON.parse(legacyRaw)
    : undefined;

  const generatorKeys = new Set([
    ...generatorKeysFromTree(version),
    ...Object.keys(legacy?.generators ?? {}),
  ]);
  const packageJsonUpdateKeys = new Set([
    ...objectKeysAtTag(version, PACKAGE_JSON_UPDATES_PATH),
    ...Object.keys(legacy?.packageJsonUpdates ?? {}),
  ]);

  if (generatorKeys.size === 0 && packageJsonUpdateKeys.size === 0) {
    return undefined;
  }

  return {
    generators: Object.fromEntries([...generatorKeys].map((key) => [key, {}])),
    ...(packageJsonUpdateKeys.size > 0
      ? {
          packageJsonUpdates: Object.fromEntries(
            [...packageJsonUpdateKeys].map((key) => [key, { version: '' }]),
          ),
        }
      : {}),
  };
};
