/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execSync } from 'node:child_process';
import {
  compareVersions,
  type MigrationsJson,
} from '../../packages/nx-plugin/src/utils/migration-versions';

/**
 * Reads the `migrations.json` each release published out of git tags, for
 * `readShippedMigrationVersions`. Shared by the release-time stamping script and
 * the weekly backfill script.
 */

export const SOURCE_MIGRATIONS_PATH = 'packages/nx-plugin/migrations.json';

/** Released versions (from `v*` tags) in descending semver order. */
export const releasedVersionsDescending = (): string[] =>
  execSync("git tag -l 'v*'", { encoding: 'utf-8' })
    .split('\n')
    .filter(Boolean)
    .map((tag) => tag.slice(1))
    .sort((a, b) => compareVersions(b, a));

/** Reads `migrations.json` as published by the given release. */
export const readReleasedMigrations = (
  version: string,
): MigrationsJson | undefined => {
  try {
    return JSON.parse(
      execSync(`git show v${version}:${SOURCE_MIGRATIONS_PATH}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }),
    );
  } catch {
    // Release predates migrations.json
    return undefined;
  }
};
