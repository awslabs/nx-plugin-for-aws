/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import { inc } from 'semver';
// eslint-disable-next-line
import { compareVersions } from '../../../packages/nx-plugin/src/utils/migration-versions';

/**
 * Version resolution for the migrate smoke test.
 *
 * The test upgrades a workspace created on a released version to the local
 * build, so it needs two things: which released version(s) to start from, and
 * what version to publish the local build as.
 */

/** Package published to the registry that the plugin's preset installs from. */
export const MIGRATE_PACKAGES = [
  '@aws/nx-plugin',
  '@aws/nx-plugin-mcp',
  '@aws/create-nx-workspace',
] as const;

/**
 * Number of previous releases to migrate from. Currently one — the latest
 * release, which is what a user upgrading today starts from. Raise via
 * `NX_E2E_MIGRATE_VERSIONS` to cover more of the supported range.
 */
const DEFAULT_START_VERSION_COUNT = 1;

/** Released versions of `@aws/nx-plugin` (from `v*` tags), newest first. */
export const releasedVersionsDescending = (): string[] =>
  execFileSync('git', ['tag', '-l', 'v*'], { encoding: 'utf-8' })
    .split('\n')
    .filter(Boolean)
    .map((tag) => tag.slice(1))
    .sort((a, b) => compareVersions(b, a));

/**
 * Released versions to migrate from, newest first.
 *
 * Read from git tags rather than the registry so the set matches the repo the
 * test runs against, and so a hop is only attempted for a release whose
 * `migrations.json` history is resolvable.
 */
export const migrateStartVersions = (): string[] => {
  const count = Number(
    process.env.NX_E2E_MIGRATE_VERSIONS ?? DEFAULT_START_VERSION_COUNT,
  );
  const released = releasedVersionsDescending();
  if (released.length === 0) {
    throw new Error(
      'No release tags found — the migrate smoke test cannot pick a start version. Fetch tags (git fetch --tags) and retry.',
    );
  }
  return released.slice(0, Math.max(1, count));
};

/**
 * Version to publish the local build as for the migrate test.
 *
 * `nx migrate` only runs a migration whose version is greater than the
 * installed one and less than or equal to the target, so the local build has to
 * carry a version above every released one — publishing it as its in-repo
 * `0.0.0` would leave every migration out of range and silently assert nothing.
 *
 * A `prerelease` bump of the latest tag lands strictly above it and below any
 * version a real release could pick next, including this repo's rc
 * prereleases (which a `patch`/`minor` bump would leapfrog) — the same rule
 * `scripts/stamp-migrations.ts` stamps unreleased migrations with.
 */
export const resolveMigrateTargetVersion = (): string => {
  const [latest] = releasedVersionsDescending();
  if (!latest) {
    throw new Error(
      'No release tags found — cannot derive a migrate target version. Fetch tags (git fetch --tags) and retry.',
    );
  }
  const target = inc(latest, 'prerelease');
  if (!target) {
    throw new Error(
      `Could not derive a migrate target version from the latest release tag (${latest}).`,
    );
  }
  return target;
};
