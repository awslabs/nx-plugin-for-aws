/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { PackageManager } from '@nx/devkit';
import { buildCreateNxWorkspaceCommand, runCLI, tmpProjPath } from '../utils';
import { existsSync, rmSync } from 'fs';
import { ensureDirSync } from 'fs-extra';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Verifies that `<pkgMgr> create @aws/nx-workspace` succeeds with only
 * `--no-interactive`, without any additional flags to set required schema
 * properties (e.g. `iacProvider`). Regression coverage for a missing default
 * that caused "Required property 'iacProvider' is missing" to abort the
 * preset after the workspace had already been created.
 */
const PACKAGE_MANAGERS: PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];

describe('smoke test - no-interactive', () => {
  PACKAGE_MANAGERS.forEach((pkgMgr) => {
    describe(pkgMgr, () => {
      const targetDir = `${tmpProjPath()}/no-interactive-${pkgMgr}`;
      const projectRoot = `${targetDir}/e2e-test`;

      beforeEach(() => {
        if (existsSync(targetDir)) {
          rmSync(targetDir, { force: true, recursive: true });
        }
        ensureDirSync(targetDir);
      });

      it(`Should create a workspace with --no-interactive - ${pkgMgr}`, async () => {
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
