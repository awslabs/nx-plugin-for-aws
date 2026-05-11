/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { PackageManager } from '@nx/devkit';
import { buildCreateNxWorkspaceCommand, runCLI, tmpProjPath } from '../utils';
import { existsSync, rmSync } from 'fs';
import { ensureDirSync } from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activatePackageManagerViaCorepack } from './corepack';

/**
 * Verifies that `<pkgMgr> create @aws/nx-workspace` succeeds with only
 * `--no-interactive` and no additional flags (no `iacProvider`, no
 * `--skipGit`). A single `--no-interactive` must be sufficient to run
 * unattended on every supported package manager.
 *
 * A second case verifies that combining `--no-interactive` with a CI
 * option that would otherwise trigger nx's "push to GitHub?" prompt
 * (`--ci=github`) still runs unattended — @aws/create-nx-workspace
 * auto-injects `--skipGit` in that specific combination so the workspace
 * doesn't hang on the push prompt that nx does not gate on the
 * interactive flag.
 *
 * Yarn is exercised twice — classic (whatever `yarn` is on PATH, typically
 * 1.x) and berry (yarn 4 activated via corepack) — since the two drive
 * different code paths in @aws/create-nx-workspace and the nx preset.
 */
interface Variant {
  variant: string;
  pkgMgr: PackageManager;
  setup?: () => void | (() => void);
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
      let teardown: (() => void) | void;

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

      it(`Should create a workspace with --no-interactive --ci=github without hanging on the push prompt - ${variant}`, async () => {
        await runCLI(
          `${buildCreateNxWorkspaceCommand(pkgMgr, 'e2e-test')} --no-interactive --ci=github`,
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
