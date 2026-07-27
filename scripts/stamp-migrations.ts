/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { releaseVersion } from 'nx/release';
import {
  type MigrationsJson,
  stampMigrationVersions,
} from '../packages/nx-plugin/src/utils/migration-versions';

/**
 * Stamps the pending release version onto migrations that don't have one yet,
 * writing back to the source `migrations.json` so the release commits it (see
 * `utils/migration-versions.ts` for the versioning model).
 *
 * Runs in the release job before `nx release`, which needs the versions in
 * place so the published `migrations.json` carries them. When every migration
 * already has a version this is a no-op, and `MIGRATION_VERSION_FILE` is left
 * unwritten so the caller knows there is nothing to commit.
 */

const MIGRATIONS_PATH = 'packages/nx-plugin/migrations.json';

/**
 * Resolve the version `nx release` is about to publish. The dry run reports the
 * version it *would* write without touching any manifest, and honours the same
 * conventional-commit config the real release uses.
 *
 * `release.version.manifestRootsToUpdate` points at `dist/{projectRoot}`, so
 * the packaged manifests must exist before this runs.
 */
const resolvePendingVersion = async (): Promise<string> => {
  const { workspaceVersion } = await releaseVersion({
    dryRun: true,
    verbose: false,
    // Mirror the release command's prerelease identifier so an rc release
    // resolves to the next rc rather than a stable version.
    preid: 'rc',
    ...(process.env.NX_RELEASE_SPECIFIER
      ? { specifier: process.env.NX_RELEASE_SPECIFIER }
      : {}),
  });
  if (!workspaceVersion) {
    throw new Error(
      'nx release version --dry-run did not resolve a version — there may be no releasable changes.',
    );
  }
  return workspaceVersion;
};

const main = async () => {
  const source: MigrationsJson = JSON.parse(
    readFileSync(MIGRATIONS_PATH, 'utf-8'),
  );

  const unversioned = Object.entries(source.generators ?? {}).filter(
    ([, entry]) => !entry.version,
  );
  if (unversioned.length === 0) {
    console.error(
      `No unversioned migrations in ${MIGRATIONS_PATH} — nothing to stamp.`,
    );
    return;
  }

  const version = await resolvePendingVersion();
  const { migrations, stamped } = stampMigrationVersions(source, version);

  writeFileSync(
    MIGRATIONS_PATH,
    `${JSON.stringify(migrations, null, 2)}\n`,
    'utf-8',
  );
  console.error(
    `Stamped ${stamped.length} migration(s) with ${version} in ${MIGRATIONS_PATH}: ${stamped.join(', ')}`,
  );

  // Report the stamped version for the release job's commit message. `nx
  // release` logs to stdout too, so this goes to a file rather than being
  // parsed out of the surrounding output. Written only when something was
  // stamped, so its absence means there is nothing to commit.
  if (process.env.MIGRATION_VERSION_FILE) {
    writeFileSync(process.env.MIGRATION_VERSION_FILE, version, 'utf-8');
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
