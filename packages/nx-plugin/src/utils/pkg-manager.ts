/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { detectPackageManager } from '@nx/devkit';

/**
 * Package manager command helpers for use in generated project files.
 *
 * These follow the same conventions as the documentation site components:
 * - `exec`: prefix for running local binaries (e.g. `npx nx`, `pnpm nx`, `bunx nx`)
 * - `run`: prefix for running package.json scripts (e.g. `npm run build`, `pnpm build`)
 *
 * We maintain our own mappings rather than using Nx's `getPackageManagerCommand()`
 * because:
 * - pnpm `exec` returns `pnpm exec` but convention is `pnpm`
 * - bun `exec` returns `bun` but convention is `bunx`
 * - bun `run()` appends `-- undefined` when called without args
 *
 * @see docs/src/components/package-manager-exec-command.astro
 * @see docs/src/components/package-manager-short-command.astro
 */
export interface PackageManagerDisplayCommands {
  /** Prefix for running local binaries: npx, pnpm, yarn, bunx */
  exec: string;
  /** Prefix for running package.json scripts: `npm run`, pnpm, yarn, bun */
  run: string;
}

const COMMANDS: Record<string, PackageManagerDisplayCommands> = {
  npm: { exec: 'npx', run: 'npm run' },
  pnpm: { exec: 'pnpm', run: 'pnpm' },
  yarn: { exec: 'yarn', run: 'yarn' },
  bun: { exec: 'bunx', run: 'bun' },
};

/**
 * Returns display-friendly command prefixes for the detected package manager.
 */
export const getPackageManagerDisplayCommands = (
  pm = detectPackageManager(),
): PackageManagerDisplayCommands => COMMANDS[pm] ?? COMMANDS['npm'];
