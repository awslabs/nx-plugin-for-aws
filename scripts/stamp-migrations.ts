/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  compareVersions,
  type MigrationsJson,
  stampMigrationVersions,
} from '../packages/nx-plugin/src/utils/migration-versions';

/**
 * Stamps versions onto the compiled `migrations.json` (see
 * `utils/migration-versions.ts` for the versioning model). Runs as part of
 * the nx-plugin `package` target, after `compile` populates dist.
 */

const SOURCE_MIGRATIONS_PATH = 'packages/nx-plugin/migrations.json';
const DIST_MIGRATIONS_PATH = 'dist/packages/nx-plugin/migrations.json';

const releaseTagsAscending = (): string[] =>
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

const main = () => {
  const migrations: MigrationsJson = JSON.parse(
    readFileSync(SOURCE_MIGRATIONS_PATH, 'utf-8'),
  );

  const tags = releaseTagsAscending();
  if (tags.length === 0) {
    throw new Error(
      'No release tags found — migrations cannot be stamped. Fetch tags (git fetch --tags) and retry.',
    );
  }

  // Earliest release tag registering each migration
  const shippedVersions: Record<string, string> = {};
  for (const tag of tags) {
    const tagged = readMigrationsAtTag(tag);
    for (const name of Object.keys(tagged?.generators ?? {})) {
      shippedVersions[name] ??= tag.slice(1);
    }
  }

  const latestVersion = tags[tags.length - 1].slice(1);
  const stamped = stampMigrationVersions(
    migrations,
    shippedVersions,
    latestVersion,
  );

  writeFileSync(
    DIST_MIGRATIONS_PATH,
    `${JSON.stringify(stamped, null, 2)}\n`,
    'utf-8',
  );
  console.log(
    `Stamped ${Object.keys(stamped.generators ?? {}).length} migration(s) into ${DIST_MIGRATIONS_PATH} (latest release: ${latestVersion})`,
  );
};

main();
