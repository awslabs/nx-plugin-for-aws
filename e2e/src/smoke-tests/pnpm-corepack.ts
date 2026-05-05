/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execSync } from 'child_process';
import { mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const PATH_SEP = process.platform === 'win32' ? ';' : ':';

/**
 * Prepare a corepack-managed pnpm binary at the given version and put its
 * shim directory at the front of process.env.PATH. Returns a teardown
 * function that restores the original PATH.
 *
 * Used by the pnpm-10 and pnpm-11 smoke tests so each variant exercises the
 * right major — pnpm 11 made `strictDepBuilds` default to `true`, removed
 * reads of the `pnpm` field in package.json, and replaced
 * `onlyBuiltDependencies` with `allowBuilds`.
 */
export const activatePnpmViaCorepack = (version: string): (() => void) => {
  const originalPath = process.env.PATH ?? '';
  const shimDir = join(
    tmpdir(),
    'nx-plugin-for-aws',
    `corepack-pnpm-${version}-bin`,
  );
  mkdirSync(shimDir, { recursive: true });
  execSync(`corepack enable --install-directory "${shimDir}"`, {
    stdio: 'inherit',
  });
  execSync(`corepack prepare pnpm@${version} --activate`, {
    stdio: 'inherit',
  });
  process.env.PATH = `${shimDir}${PATH_SEP}${originalPath}`;
  return () => {
    process.env.PATH = originalPath;
  };
};
