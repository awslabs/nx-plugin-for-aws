/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// eslint-disable-next-line
import { publishWithRetry } from '../../../scripts/release';
import { MIGRATE_PACKAGES } from './migrate-versions';

/** Dist-tag to publish under, so `latest` keeps pointing at the 0.0.0 build. */
const RELEASE_DIST_TAG = 'release-e2e';

/** Unique per run, and above any version a real release could pick. */
const releaseTestVersion = () => `999.9.9-release-e2e.${process.pid}`;

const workspaceRoot = join(__dirname, '../../..');
const distManifest = (pkg: string) =>
  join(
    workspaceRoot,
    'dist/packages',
    pkg.replace('@aws/', ''),
    'package.json',
  );

const gitTags = (): string =>
  execFileSync('git', ['tag', '-l'], {
    cwd: workspaceRoot,
    encoding: 'utf-8',
    windowsHide: true,
  });

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
    return [];
  }
};

describe('smoke test - release', () => {
  const version = releaseTestVersion();
  const originalManifests = new Map<string, string>();

  afterAll(() => {
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
    const tagsBefore = gitTags();

    // nx skips a package whose version already carries the requested dist-tag
    // and exits zero without publishing, so a version already on the registry
    // would pass the assertions below without proving anything.
    for (const pkg of MIGRATE_PACKAGES) {
      expect(
        versionsOnRegistry(pkg, localRegistry),
        `${pkg}@${version} is already on the local registry — this test cannot prove a publish ran`,
      ).not.toContain(version);
    }

    for (const pkg of MIGRATE_PACKAGES) {
      const path = distManifest(pkg);
      const contents = readFileSync(path, 'utf-8');
      originalManifests.set(path, contents);
      writeFileSync(
        path,
        `${JSON.stringify({ ...JSON.parse(contents), version }, null, 2)}\n`,
      );
    }

    await publishWithRetry({
      tag: RELEASE_DIST_TAG,
      additionalArgs: [`--registry=${localRegistry}`],
      // A rejected flag fails the same way every time.
      attempts: 1,
      cwd: workspaceRoot,
    });

    for (const pkg of MIGRATE_PACKAGES) {
      const published = execSync(
        `npm view ${pkg}@${version} version --registry=${localRegistry} --json`,
        { encoding: 'utf-8', env: process.env, windowsHide: true },
      );
      expect(JSON.parse(published)).toBe(version);
    }

    // `nx release publish` only publishes — it never tags or writes a changelog,
    // unlike the `nx release` the release script runs before it. Asserted so a
    // change to publishWithRetry can't start cutting releases from a test.
    expect(gitTags()).toBe(tagsBefore);
  });
});
