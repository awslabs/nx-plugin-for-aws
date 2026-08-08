/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { assembleMigrations } from '../packages/nx-plugin/src/utils/migration-manifest';
import {
  discoverMigrations,
  readPackageJsonUpdates,
} from './utils/migration-folders';

/**
 * Assembles `packages/nx-plugin/migrations.json` from the plugin's source: the
 * per-migration folders, `packageJsonUpdates.json`, and the version sync entry
 * (see `migration-manifest.ts`). The file is gitignored — this reproduces it, so
 * nx has a manifest to load in the source tree and the compiled asset is built
 * from it.
 *
 * Runs before `compile`, so a fresh checkout and every build has it.
 *
 * Usage: tsx scripts/generate-migrations.ts [--out <path>]
 */

const PLUGIN_PACKAGE_JSON = 'packages/nx-plugin/package.json';
const DEFAULT_OUT = 'packages/nx-plugin/migrations.json';

const readOutPath = (argv: string[]): string => {
  const index = argv.indexOf('--out');
  if (index === -1) {
    return DEFAULT_OUT;
  }
  const out = argv[index + 1];
  if (!out || out.startsWith('--')) {
    throw new Error('--out requires a path');
  }
  return out;
};

const main = () => {
  const outPath = readOutPath(process.argv.slice(2));
  const { name } = JSON.parse(readFileSync(PLUGIN_PACKAGE_JSON, 'utf-8'));

  const migrations = assembleMigrations(
    name,
    discoverMigrations(),
    readPackageJsonUpdates(),
  );

  writeFileSync(outPath, `${JSON.stringify(migrations, null, 2)}\n`, 'utf-8');
  console.log(
    `Assembled ${Object.keys(migrations.generators ?? {}).length} migration(s) into ${outPath}`,
  );
};

main();
