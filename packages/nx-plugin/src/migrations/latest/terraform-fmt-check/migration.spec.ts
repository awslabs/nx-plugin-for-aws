/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  readProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import { TERRAFORM_PROJECT_GENERATOR_INFO } from '../../../terraform/project/generator';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import migration from './migration';

const PROJECT = '@proj/tf-lib';

/** The `fmt` target as it was vended before this migration. */
const writingFmtTarget = () => ({
  executor: 'nx:run-commands',
  cache: true,
  inputs: ['default'],
  options: {
    command: 'terraform fmt',
    forwardAllArgs: true,
    cwd: '{projectRoot}/src',
  },
});

const addTerraformProject = (
  tree: Tree,
  targets: Record<string, unknown> = { fmt: writingFmtTarget() },
) =>
  addProjectConfiguration(tree, PROJECT, {
    root: 'packages/tf-lib',
    projectType: 'library',
    metadata: { generator: TERRAFORM_PROJECT_GENERATOR_INFO.id } as never,
    targets: targets as never,
  });

/** The misaligned `backend "s3"` block the generator wrote. */
const MISALIGNED_PROVIDERS = `terraform {
  required_version = ">= 1.0"

  backend "s3" {
    encrypt        = true
    use_lockfile   = true
  }
}
`;

describe('terraform-fmt-check migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should move the write off the base target and onto a fix configuration', async () => {
    addTerraformProject(tree);

    await migration(tree);

    const fmt = readProjectConfiguration(tree, PROJECT).targets.fmt;
    // Writing from the base target rewrote the `default` input its own hash was
    // computed from, so it could never cache-hit.
    expect(fmt.options.command).toBe('terraform fmt -check -diff');
    expect(fmt.inputs).toEqual(['default']);
    expect(fmt.configurations.fix.command).toBe('terraform fmt');
    expect(fmt.configurations['skip-lint'].command).toBe('node -e ""');
    // Options the user may have set are preserved.
    expect(fmt.options.cwd).toBe('{projectRoot}/src');
    expect(fmt.options.forwardAllArgs).toBe(true);
  });

  it('should add a lint target which orchestrates the format check', async () => {
    addTerraformProject(tree);

    await migration(tree);

    expect(readProjectConfiguration(tree, PROJECT).targets.lint.dependsOn) //
      .toEqual(['fmt']);
  });

  it('should preserve an existing lint target', async () => {
    addTerraformProject(tree, {
      fmt: writingFmtTarget(),
      lint: { dependsOn: ['fmt', 'my-check'] },
    });

    await migration(tree);

    expect(readProjectConfiguration(tree, PROJECT).targets.lint.dependsOn) //
      .toEqual(['fmt', 'my-check']);
  });

  it('should skip and report a customised fmt target', async () => {
    const customised = {
      ...writingFmtTarget(),
      options: { command: 'terraform fmt ./modules', cwd: '{projectRoot}' },
    };
    addTerraformProject(tree, { fmt: customised });

    const { nextSteps } = await migration(tree);

    expect(readProjectConfiguration(tree, PROJECT).targets.fmt).toEqual(
      customised,
    );
    expect(
      readProjectConfiguration(tree, PROJECT).targets.lint,
    ).toBeUndefined();
    expect(nextSteps).toEqual([expect.stringContaining(PROJECT)]);
  });

  it('should leave a project from another generator alone', async () => {
    addProjectConfiguration(tree, '@proj/ts-lib', {
      root: 'packages/ts-lib',
      metadata: { generator: 'ts#project' } as never,
      targets: { fmt: writingFmtTarget() } as never,
    });

    await migration(tree);

    const { targets } = readProjectConfiguration(tree, '@proj/ts-lib');
    expect(targets.fmt.options.command).toBe('terraform fmt');
    expect(targets.lint).toBeUndefined();
  });

  it('should realign the vended providers.tf backend block', async () => {
    addTerraformProject(tree);
    tree.write('packages/tf-lib/src/providers.tf', MISALIGNED_PROVIDERS);

    await migration(tree);

    // `terraform fmt` aligns a block's arguments to a common width, so the
    // newly-checking target rejects this file until it matches. The write the
    // old target performed on every run is what had kept it formatted.
    const providers = tree.read('packages/tf-lib/src/providers.tf', 'utf-8')!;
    expect(providers).toContain('encrypt      = true');
    expect(providers).toContain('use_lockfile = true');
    // Everything outside the backend block is untouched.
    expect(providers).toContain('required_version = ">= 1.0"');
  });

  it('should be idempotent', async () => {
    addTerraformProject(tree);
    tree.write('packages/tf-lib/src/providers.tf', MISALIGNED_PROVIDERS);

    await migration(tree);
    const after = [
      tree.read('packages/tf-lib/project.json', 'utf-8'),
      tree.read('packages/tf-lib/src/providers.tf', 'utf-8'),
    ];

    const { nextSteps } = await migration(tree);

    expect([
      tree.read('packages/tf-lib/project.json', 'utf-8'),
      tree.read('packages/tf-lib/src/providers.tf', 'utf-8'),
    ]).toEqual(after);
    expect(nextSteps).toEqual([]);
  });
});
