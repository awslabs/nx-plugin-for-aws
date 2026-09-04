/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PATH_SEP = process.platform === 'win32' ? ';' : ':';

// Corepack resolves the spec against the registry on activation, so passing a
// major runs the smoke test against the current latest release of that line.
// Pass an exact version to pin a lane to a known-good release.
export const activatePackageManagerViaCorepack = (
  packageManager: 'pnpm' | 'yarn',
  version: number | string,
  envOverrides: Record<string, string> = {},
): (() => void) => {
  const originalPath = process.env.PATH ?? '';
  const originalEnv: Record<string, string | undefined> = Object.fromEntries(
    Object.keys(envOverrides).map((k) => [k, process.env[k]]),
  );
  const shimDir = join(
    tmpdir(),
    'nx-plugin-for-aws',
    `corepack-${packageManager}-${version}-bin`,
  );
  mkdirSync(shimDir, { recursive: true });
  execSync(`corepack enable --install-directory "${shimDir}"`, {
    stdio: 'inherit',
  });
  execSync(`corepack prepare ${packageManager}@${version} --activate`, {
    stdio: 'inherit',
  });
  process.env.PATH = `${shimDir}${PATH_SEP}${originalPath}`;
  for (const [k, v] of Object.entries(envOverrides)) {
    process.env[k] = v;
  }
  return () => {
    process.env.PATH = originalPath;
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  };
};
