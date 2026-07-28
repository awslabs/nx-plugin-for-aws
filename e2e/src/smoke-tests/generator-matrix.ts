/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { runCLI } from '../utils';

interface RunCliOpts {
  cwd: string;
  env: Record<string, string>;
}

/**
 * Scaffolds every generator, component and connection permutation the smoke
 * tests cover, by running the plugin's own `internal#test-matrix` generator.
 *
 * The matrix lives in the plugin rather than here so each released version
 * carries the matrix of the generators *it* had: a test upgrading an old
 * workspace scaffolds with that version's own matrix and never has to reason
 * about which generators existed when. **Add a new generator to
 * `packages/nx-plugin/src/internal/test-matrix/generator.ts`, not to this file.**
 *
 * Generators inherit the `iac` selected when the workspace was created, so both
 * the `cdk-deploy` and `terraform-deploy` pipelines exercise the same set. Pass
 * `{ infra: 'terraform' }` for a Terraform workspace so the matrix scaffolds the
 * matching infrastructure project; a CDK workspace also gets a Terraform project
 * alongside, so one workspace covers both providers' output.
 *
 * By default the matrix defers installing dependencies so the install happens
 * once (via `runInstall` afterwards) rather than after every generator. Pass
 * `{ preferInstallDependencies: true }` to install after each one instead — the
 * idempotency test needs this so lockfiles (including `uv.lock`) are fully
 * synced before it snapshots the workspace.
 */
export const runGeneratorMatrix = async (
  opts: RunCliOpts,
  {
    preferInstallDependencies = false,
    infra = 'cdk',
  }: {
    preferInstallDependencies?: boolean;
    infra?: 'cdk' | 'terraform';
  } = {},
) => {
  await runCLI(
    `generate @aws/nx-plugin:internal#test-matrix --infra=${infra} --preferInstallDependencies=${preferInstallDependencies} --no-interactive`,
    opts,
  );
};
