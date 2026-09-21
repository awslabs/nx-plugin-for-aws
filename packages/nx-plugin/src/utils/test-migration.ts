/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Tree } from '@nx/devkit';

/** Root of the plugin's migration folders, `src/migrations/<dir>/<name>/`. */
export const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

/**
 * Locate a migration's folder by its name, wherever it currently lives.
 *
 * A migration is committed under `latest/<name>` and moved to
 * `v<version>/<order>-<name>` by `scripts/backfill-migration-versions.ts` once
 * the release that shipped it is known. A spec that needs another migration
 * (for example to check that running every later migration converges on what
 * the generator writes today) must not hardcode either path, since the weekly
 * `update-versions` workflow moves the folder and would break the import.
 */
export const migrationDir = (name: string): string => {
  const folderName = new RegExp(`^(\\d+-)?${name}$`);
  for (const group of readdirSync(MIGRATIONS_DIR, { withFileTypes: true })) {
    if (!group.isDirectory()) {
      continue;
    }
    const match = readdirSync(join(MIGRATIONS_DIR, group.name)).find((entry) =>
      folderName.test(entry),
    );
    if (match) {
      return join(MIGRATIONS_DIR, group.name, match);
    }
  }
  throw new Error(`No migration named ${name} under ${MIGRATIONS_DIR}`);
};

/** Load a migration's default export by name, wherever its folder currently lives. */
export const importMigration = async (
  name: string,
): Promise<(tree: Tree) => Promise<unknown>> => {
  const module = await import(
    /* @vite-ignore */ join(migrationDir(name), 'migration.ts')
  );
  return module.default;
};
