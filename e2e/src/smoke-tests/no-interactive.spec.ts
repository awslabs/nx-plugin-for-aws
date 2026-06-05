/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, rmSync } from 'node:fs';
import type { PackageManager } from '@nx/devkit';
import { ensureDirSync } from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCreateNxWorkspaceCommand, runCLI, tmpProjPath } from '../utils';
import { activatePackageManagerViaCorepack } from './corepack';

/**
 * Verifies that `<pkgMgr> create @aws/nx-workspace --no-interactive` runs
 * unattended — no `iac`, no `--skipGit`, no extra flags.
 *
 * Yarn is exercised twice — classic and berry (yarn 4 via corepack) —
 * since they drive different code paths.
 */
interface Variant {
  variant: string;
  pkgMgr: PackageManager;
  setup?: () => undefined | (() => void);
}

const VARIANTS: Variant[] = [
  { variant: 'npm', pkgMgr: 'npm' },
  { variant: 'pnpm', pkgMgr: 'pnpm' },
  {
    variant: 'yarn-classic',
    pkgMgr: 'yarn',
    setup: () => activatePackageManagerViaCorepack('yarn', 1),
  },
  {
    variant: 'yarn-4',
    pkgMgr: 'yarn',
    setup: () =>
      activatePackageManagerViaCorepack('yarn', 4, {
        YARN_ENABLE_HARDENED_MODE: '0',
        YARN_ENABLE_IMMUTABLE_INSTALLS: 'false',
      }),
  },
  { variant: 'bun', pkgMgr: 'bun' },
];

describe('smoke test - no-interactive', () => {
  VARIANTS.forEach(({ variant, pkgMgr, setup }) => {
    describe(variant, () => {
      const targetDir = `${tmpProjPath()}/no-interactive-${variant}`;
      const projectRoot = `${targetDir}/e2e-test`;
      let teardown: (() => void) | undefined;

      beforeEach(() => {
        teardown = setup?.();
        if (existsSync(targetDir)) {
          rmSync(targetDir, { force: true, recursive: true });
        }
        ensureDirSync(targetDir);
      });
      afterEach(() => {
        teardown?.();
        teardown = undefined;
      });

      it(`Should create a workspace with --no-interactive - ${variant}`, async () => {
        await runCLI(
          `${buildCreateNxWorkspaceCommand(pkgMgr, 'e2e-test')} --no-interactive`,
          {
            cwd: targetDir,
            prefixWithPackageManagerCmd: false,
            redirectStderr: true,
          },
        );

        expect(existsSync(`${projectRoot}/package.json`)).toBe(true);
        expect(existsSync(`${projectRoot}/nx.json`)).toBe(true);
        expect(existsSync(`${projectRoot}/aws-nx-plugin.config.mts`)).toBe(
          true,
        );
      });
    });
  });
});
