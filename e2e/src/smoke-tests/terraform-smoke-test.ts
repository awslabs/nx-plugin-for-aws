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
import { runTerraformPlanTest } from './terraform-plan-test';

/**
 * Runs the full matrix of generators against a Terraform-backed workspace.
 *
 * Mirrors the generator coverage in `smoke-test.ts` (which exercises CDK) so
 * that `terraform` and `terraform-deploy` smoke tests both verify the same
 * generators, options and connection permutations under the Terraform IaC
 * provider.
 *
 * The MCP gateways are scaffolded without a Cedar policy engine: AgentCore
 * injects a server-managed `metadata_configuration.allowed_request_headers`
 * on targets of a policy-engine gateway, and the AWS provider declares that
 * block `Optional` rather than `Computed`, so every apply fails the post-apply
 * consistency check. The header is rejected if declared explicitly, so there
 * is no configuration that reconciles it. Cedar stays covered by `cdk-deploy`,
 * which CloudFormation applies without an equivalent check. Restore the policy
 * engine here once the provider marks the block `Computed` — tracked in #1065.
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

  await runGeneratorMatrix(opts, { cedarPolicy: false });

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
      const { opts } = await runTerraformSmokeTest(
        `${tmpProjPath()}/${variant}-${pkgMgr}`,
        pkgMgr,
        options.onProjectCreate,
      );

      // Validate the generated Terraform plans cleanly, with mocked providers
      // so no AWS credentials are needed. Catches plan-time graph errors the
      // build can't (e.g. a for_each over an apply-time value).
      await runTerraformPlanTest(opts);
    });
  });
};
