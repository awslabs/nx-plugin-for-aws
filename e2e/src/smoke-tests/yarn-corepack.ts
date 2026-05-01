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
 * Prepare a corepack-managed yarn binary at the given major version and put
 * its shim directory at the front of process.env.PATH. Returns a teardown
 * function that restores the original PATH.
 *
 * Used by the yarn-4 smoke tests to run the generator pipeline against yarn
 * berry, since the default `yarn` on most runners is still 1.x.
 */
export const activateYarnViaCorepack = (version: string): (() => void) => {
  const originalPath = process.env.PATH ?? '';
  // Yarn berry auto-enables hardened mode on public PR CI runs AND immutable
  // installs whenever `CI` is set — both refuse any install that would
  // modify the lockfile. Our smoke test scaffolds a fresh workspace whose
  // initial yarn.lock is empty, so every dependency resolution counts as a
  // "modification". Disable both for the duration of the test.
  const overrides: Record<string, string> = {
    YARN_ENABLE_HARDENED_MODE: '0',
    YARN_ENABLE_IMMUTABLE_INSTALLS: 'false',
  };
  const originals: Record<string, string | undefined> = Object.fromEntries(
    Object.keys(overrides).map((k) => [k, process.env[k]]),
  );
  const shimDir = join(
    tmpdir(),
    'nx-plugin-for-aws',
    `corepack-yarn-${version}-bin`,
  );
  mkdirSync(shimDir, { recursive: true });
  execSync(`corepack enable --install-directory "${shimDir}"`, {
    stdio: 'inherit',
  });
  execSync(`corepack prepare yarn@${version} --activate`, {
    stdio: 'inherit',
  });
  process.env.PATH = `${shimDir}${PATH_SEP}${originalPath}`;
  for (const [k, v] of Object.entries(overrides)) {
    process.env[k] = v;
  }
  return () => {
    process.env.PATH = originalPath;
    for (const [k, v] of Object.entries(originals)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  };
};
