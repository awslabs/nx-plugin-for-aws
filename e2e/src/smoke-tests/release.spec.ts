/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// eslint-disable-next-line
import { publishWithRetry } from '../../../scripts/release';
import { MIGRATE_PACKAGES } from './migrate-versions';

/**
 * release smoke test — publishes the local build to the local registry through
 * the release script's own `publishWithRetry`, and asserts all three packages
 * land.
 *
 * The command `nx release publish` builds is derived from the active package
 * manager's version, and a package manager that rejects the flag spelling nx
 * picks fails every publish. Nothing else in the suite catches that: the other
 * smoke tests publish with plain `npm publish`, and unit tests never invoke the
 * executor. So the release lane's first signal used to be a failed release, on
 * main, after the tag and GitHub release had already been created.
 *
 * Three details give this test teeth:
 *
 * - **It publishes a version the registry has never seen**, and asserts that
 *   before publishing. nx short-circuits a package whose version already carries
 *   the requested dist-tag and exits zero without running the publish command,
 *   so reusing the `0.0.0` build `global-setup` published would pass whatever
 *   the active package manager does.
 * - **It publishes under a dedicated dist-tag.** `latest` keeps pointing at the
 *   `0.0.0` build every other smoke test resolves.
 * - **It runs the release script's own function**, not a copy of the command, so
 *   a change to how the release publishes is covered by construction.
 */
const RELEASE_DIST_TAG = 'release-e2e';
/**
 * Version to publish under. Above every real release so it can never be
 * mistaken for one, and unique per run so nx always performs a real publish
 * rather than re-tagging a version the registry already holds.
 */
const releaseTestVersion = () => `999.9.9-release-e2e.${process.pid}`;

const workspaceRoot = join(__dirname, '../../..');
const distManifest = (pkg: string) =>
  join(
    workspaceRoot,
    'dist/packages',
    pkg.replace('@aws/', ''),
    'package.json',
  );

/** Versions the local registry currently serves for a package. */
const versionsOnRegistry = (pkg: string, registry: string): string[] => {
  try {
    const versions = JSON.parse(
      execSync(`npm view ${pkg} versions --registry=${registry} --json`, {
        encoding: 'utf-8',
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }),
    );
    // npm returns a bare string when only one version exists.
    return Array.isArray(versions) ? versions : [versions];
  } catch {
    // Unpublished package — nothing on the registry yet.
    return [];
  }
};

describe('smoke test - release', () => {
  const version = releaseTestVersion();
  const originalManifests = new Map<string, string>();

  afterAll(() => {
    // Restore the versions the other smoke tests' published build carries.
    for (const [path, contents] of originalManifests) {
      writeFileSync(path, contents);
    }
  });

  it('should publish every package with the release script', async () => {
    const localRegistry = process.env.NX_E2E_LOCAL_REGISTRY;
    if (!localRegistry) {
      throw new Error(
        'NX_E2E_LOCAL_REGISTRY is unset — global setup did not start the local registry',
      );
    }

    // The assertions below only prove a publish happened if the registry does
    // not already serve this version — otherwise nx skips the publish, exits
    // zero, and every check still passes. Assert the precondition rather than
    // assume it.
    for (const pkg of MIGRATE_PACKAGES) {
      expect(
        versionsOnRegistry(pkg, localRegistry),
        `${pkg}@${version} is already on the local registry — this test cannot prove a publish ran`,
      ).not.toContain(version);
    }

    // Publish a version the registry has never seen, so nx cannot skip the
    // publish it would otherwise short-circuit as already released.
    for (const pkg of MIGRATE_PACKAGES) {
      const path = distManifest(pkg);
      const contents = readFileSync(path, 'utf-8');
      originalManifests.set(path, contents);
      const manifest = JSON.parse(contents);
      manifest.version = version;
      writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
    }

    await publishWithRetry({
      tag: RELEASE_DIST_TAG,
      additionalArgs: [`--registry=${localRegistry}`],
      // A flag the package manager rejects fails identically on every attempt,
      // so don't spend the backoff waiting to confirm it.
      attempts: 1,
      cwd: workspaceRoot,
    });

    // publishWithRetry throws on a failed publish, but a package skipped as
    // already-present also exits zero — so confirm the registry really serves
    // each package at this version.
    for (const pkg of MIGRATE_PACKAGES) {
      const published = execSync(
        `npm view ${pkg}@${version} version --registry=${localRegistry} --json`,
        { encoding: 'utf-8', env: process.env, windowsHide: true },
      );
      expect(JSON.parse(published)).toBe(version);
    }
  });
});
