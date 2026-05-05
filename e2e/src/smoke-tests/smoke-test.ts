/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { PackageManager } from '@nx/devkit';
import { buildCreateNxWorkspaceCommand, runCLI, tmpProjPath } from '../utils';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { ensureDirSync } from 'fs-extra';
import { join } from 'path';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { runGeneratorMatrix } from './generator-matrix';

export const runSmokeTest = async (
  dir: string,
  pkgMgr: string,
  onProjectCreate?: (projectRoot: string) => void,
) => {
  await runCLI(
    `${buildCreateNxWorkspaceCommand(pkgMgr, 'e2e-test', 'CDK')} --interactive=false --skipGit`,
    {
      cwd: dir,
      prefixWithPackageManagerCmd: false,
      redirectStderr: true,
    },
  );
  const projectRoot = `${dir}/e2e-test`;
  const opts = {
    cwd: projectRoot,
    env: {
      NX_DAEMON: 'false',
      NODE_OPTIONS: '--max-old-space-size=8192',
    },
  };
  if (onProjectCreate) {
    onProjectCreate(projectRoot);
  }

  // CDK-specific infrastructure projects (not part of the shared matrix).
  await runCLI(
    `generate @aws/nx-plugin:ts#infra --name=infra --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#infra --name=infra-with-stages --enableStageConfig=true --no-interactive`,
    opts,
  );

  await runGeneratorMatrix(opts);

  // Extra: generate a terraform project alongside CDK to verify both coexist.
  await runCLI(
    `generate @aws/nx-plugin:terraform#project --name=tf-infra --no-interactive`,
    opts,
  );

  // Wire up website, cognito and trpc api
  writeFileSync(
    `${opts.cwd}/packages/infra/src/stacks/application-stack.ts`,
    readFileSync(
      join(__dirname, '../files/application-stack.ts.template'),
      'utf-8',
    ),
  );

  // Since the smoke tests don't run in a git repo, we need to exclude some patterns for the license sync
  writeFileSync(
    `${opts.cwd}/aws-nx-plugin.config.mts`,
    readFileSync(
      join(__dirname, '../files/aws-nx-plugin.config.mts.template'),
      'utf-8',
    ),
  );

  await runCLI(`sync --verbose`, opts);
  await runCLI(
    `run-many --target build --all --output-style=stream --skip-nx-cache --verbose`,
    opts,
  );

  return { opts };
};

export interface SmokeTestOptions {
  /**
   * Label used in the describe block (defaults to `pkgMgr`). Allows separate
   * variants of the same package manager — e.g. "yarn" for classic and
   * "yarn-4" for berry — to be targeted individually from the CI matrix.
   */
  variant?: string;
  /**
   * Optional per-variant setup. Runs inside `beforeEach` so each test gets a
   * clean environment (e.g. activating yarn 4 via corepack). Returning a
   * teardown function registers it for `afterEach`.
   */
  setup?: () => void | (() => void);
  onProjectCreate?: (projectRoot: string) => void;
}

export const smokeTest = (
  pkgMgr: PackageManager,
  options: SmokeTestOptions = {},
) => {
  const variant = options.variant ?? pkgMgr;
  describe(`smoke test - ${variant}`, () => {
    let teardown: (() => void) | void;
    beforeEach(() => {
      teardown = options.setup?.();
      const targetDir = `${tmpProjPath()}/${variant}`;
      console.log(`Cleaning target directory ${targetDir}`);
      if (existsSync(targetDir)) {
        rmSync(targetDir, { force: true, recursive: true });
      }
      ensureDirSync(targetDir);
    });
    afterEach(() => {
      teardown?.();
      teardown = undefined;
    });

    it(`Should generate and build - ${variant}`, async () => {
      await runSmokeTest(
        `${tmpProjPath()}/${variant}`,
        pkgMgr,
        options.onProjectCreate,
      );
    });
  });
};
