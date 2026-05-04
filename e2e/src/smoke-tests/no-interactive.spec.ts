/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { PackageManager } from '@nx/devkit';
import { buildCreateNxWorkspaceCommand, runCLI, tmpProjPath } from '../utils';
import { existsSync, rmSync } from 'fs';
import { ensureDirSync } from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activateYarnViaCorepack } from './yarn-corepack';

/**
 * Verifies that `<pkgMgr> create @aws/nx-workspace` succeeds with only
 * `--no-interactive`, without any additional flags to set required schema
 * properties (e.g. `iacProvider`). Regression coverage for a missing default
 * that caused "Required property 'iacProvider' is missing" to abort the
 * preset after the workspace had already been created.
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
  { variant: 'yarn-classic', pkgMgr: 'yarn' },
  {
    variant: 'yarn-4',
    pkgMgr: 'yarn',
    setup: () => activateYarnViaCorepack('4.14.1'),
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
          `${buildCreateNxWorkspaceCommand(pkgMgr, 'e2e-test')} --no-interactive --skipGit`,
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
