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
 * Reads which release shipped each migration out of git history. Shared by the
 * package-time stamping script and the weekly backfill script.
 */

export const SOURCE_MIGRATIONS_PATH = 'packages/nx-plugin/migrations.json';

/** Release tags (`v*`) in ascending semver order. */
export const releaseTagsAscending = (): string[] =>
  execSync("git tag -l 'v*'", { encoding: 'utf-8' })
    .split('\n')
    .filter(Boolean)
    .sort((a, b) => compareVersions(a.slice(1), b.slice(1)));

const readMigrationsAtTag = (tag: string): MigrationsJson | undefined => {
  try {
    return JSON.parse(
      execSync(`git show ${tag}:${SOURCE_MIGRATIONS_PATH}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }),
    );
  } catch {
    // Tag predates migrations.json
    return undefined;
  }
};

/**
 * Map of migration key -> version of the earliest release tag registering it.
 * A migration that hasn't been released is absent.
 */
export const readShippedMigrationVersions = (
  tags: string[],
): Record<string, string> => {
  const shippedVersions: Record<string, string> = {};
  for (const tag of tags) {
    const tagged = readMigrationsAtTag(tag);
    for (const name of Object.keys(tagged?.generators ?? {})) {
      shippedVersions[name] ??= tag.slice(1);
    }
  }
  return shippedVersions;
};
