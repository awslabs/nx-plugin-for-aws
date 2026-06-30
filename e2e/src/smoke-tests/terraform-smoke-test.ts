/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDirSync } from 'fs-extra';
import { beforeEach, describe, it } from 'vitest';
import { createTestWorkspace, runCLI, runInstall, tmpProjPath } from '../utils';
import { runGeneratorMatrix } from './generator-matrix';

/**
 * Runs the full matrix of generators against a Terraform-backed workspace.
 *
 * Mirrors the generator coverage in `smoke-test.ts` (which exercises CDK) so
 * that `terraform` and `terraform-deploy` smoke tests both verify the same
 * generators, options and connection permutations under the Terraform IaC
 * provider.
 */
export const runTerraformSmokeTest = async (
  dir: string,
  pkgMgr: string,
  onProjectCreate?: (projectRoot: string) => void,
  beforeBuild?: (projectRoot: string) => void | Promise<void>,
) => {
  const projectRoot = await createTestWorkspace(
    pkgMgr,
    dir,
    'e2e-test',
    'terraform',
  );
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

  // Every generator runs with `--prefer-install-dependencies=false` to avoid a
  // slow install after each one; `runInstall` below installs the full
  // accumulated set once before the build. Generators still self-install when
  // skipping would leave a graph-critical dependency unresolvable.

  // Terraform application project that wires everything together.
  await runCLI(
    `generate @aws/nx-plugin:terraform#project --name=infra --type=application --no-interactive --prefer-install-dependencies=false`,
    opts,
  );

  await runGeneratorMatrix(opts);

  // Since the smoke tests don't run in a git repo, we need to exclude some
  // patterns for the license sync.
  writeFileSync(
    `${opts.cwd}/aws-nx-plugin.config.mts`,
    readFileSync(
      join(__dirname, '../files/aws-nx-plugin.config.mts.template'),
      'utf-8',
    ),
  );

  if (beforeBuild) {
    await beforeBuild(projectRoot);
  }

  // Install the full set of dependencies accumulated across all generators.
  await runInstall(opts);

  await runCLI(`sync --verbose`, opts);
  await runCLI(
    `run-many --target build --all --output-style=stream --skip-nx-cache --verbose`,
    opts,
  );

  return { opts };
};

export interface TerraformSmokeTestOptions {
  /** Label for the describe block (defaults to `pkgMgr`). */
  variant?: string;
  onProjectCreate?: (projectRoot: string) => void;
}

export const terraformSmokeTest = (
  pkgMgr: string,
  options: TerraformSmokeTestOptions = {},
) => {
  const variant = options.variant ?? pkgMgr;
  describe(`smoke test - ${variant}`, () => {
    beforeEach(() => {
      const targetDir = `${tmpProjPath()}/${variant}-${pkgMgr}`;
      console.log(`Cleaning target directory ${targetDir}`);
      if (existsSync(targetDir)) {
        rmSync(targetDir, { force: true, recursive: true });
      }
      ensureDirSync(targetDir);
    });

    it(`Should generate and build - ${variant}`, async () => {
      await runTerraformSmokeTest(
        `${tmpProjPath()}/${variant}-${pkgMgr}`,
        pkgMgr,
        options.onProjectCreate,
      );
    });
  });
};
