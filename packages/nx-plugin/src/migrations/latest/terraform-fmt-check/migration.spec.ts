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

  it('should leave a customised backend block alone and report it', async () => {
    // `terraform fmt` aligns `=` to the widest key in the whole block, so a
    // block carrying the user's own arguments has a width this cannot know.
    // Rewriting the two vended keys to their own width would push them out of
    // alignment with the user's and fail the check this migration installs.
    const customised = `terraform {
  backend "s3" {
    encrypt        = true
    use_lockfile   = true
    bucket         = "my-state-bucket"
    dynamodb_table = "tf-locks"
  }
}
`;
    addTerraformProject(tree);
    tree.write('packages/tf-lib/src/providers.tf', customised);

    const { nextSteps } = await migration(tree);

    expect(tree.read('packages/tf-lib/src/providers.tf', 'utf-8')).toBe(
      customised,
    );
    expect(nextSteps).toEqual([
      expect.stringContaining('packages/tf-lib/src/providers.tf'),
    ]);
    expect(nextSteps[0]).toContain('--configuration=fix');
  });

  it('should leave an already-aligned vended backend block untouched', async () => {
    const aligned = `terraform {
  backend "s3" {
    encrypt      = true
    use_lockfile = true
  }
}
`;
    addTerraformProject(tree);
    tree.write('packages/tf-lib/src/providers.tf', aligned);

    const { nextSteps } = await migration(tree);

    expect(tree.read('packages/tf-lib/src/providers.tf', 'utf-8')).toBe(
      aligned,
    );
    expect(nextSteps).toEqual([]);
  });

  it('should preserve a users own fmt configurations', async () => {
    addTerraformProject(tree, {
      fmt: {
        ...writingFmtTarget(),
        configurations: {
          fix: { command: 'terraform fmt -recursive' },
          'skip-lint': { command: 'echo MINE' },
        },
      },
    });

    await migration(tree);

    // Their configurations win, as their `options` do — someone who set `fix`
    // to cover nested modules keeps it.
    const { configurations } = readProjectConfiguration(tree, PROJECT).targets
      .fmt;
    expect(configurations.fix.command).toBe('terraform fmt -recursive');
    expect(configurations['skip-lint'].command).toBe('echo MINE');
  });

  it('should wire the new lint target to license-check when the workspace licenses', async () => {
    tree.write('package.json', JSON.stringify({ name: '@proj/source' }));
    addProjectConfiguration(tree, '@proj/source', {
      root: '.',
      targets: { 'license-check': { executor: 'nx:noop' } },
    });
    addTerraformProject(tree);

    await migration(tree);

    // Every other linting project depends on the root license-check, so the
    // new target must too — else the next `license` run adds it and diffs.
    expect(
      readProjectConfiguration(tree, PROJECT).targets.lint.dependsOn,
    ).toContainEqual({ projects: ['@proj/source'], target: 'license-check' });
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
