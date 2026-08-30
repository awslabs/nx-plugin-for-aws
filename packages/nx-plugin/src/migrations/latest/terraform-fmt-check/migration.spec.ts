/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  joinPathFragments,
  readProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import { TERRAFORM_PROJECT_GENERATOR_INFO } from '../../../terraform/project/generator';
import { METRIC_ID } from '../../../utils/metrics';
import {
  PACKAGES_DIR,
  SHARED_TERRAFORM_DIR,
} from '../../../utils/shared-constructs-constants';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import migration from './migration';

const PROJECT = '@proj/tf-lib';

const SHARED_TERRAFORM_SRC = joinPathFragments(
  PACKAGES_DIR,
  SHARED_TERRAFORM_DIR,
  'src',
);
const METRICS_PATH = joinPathFragments(
  SHARED_TERRAFORM_SRC,
  'metrics',
  'metrics.tf',
);
const READ_PATH = joinPathFragments(
  SHARED_TERRAFORM_SRC,
  'core',
  'runtime-config',
  'read',
  'read.tf',
);

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

/** The misaligned `metrics.tf` the generators wrote. */
const MISALIGNED_METRICS = `locals {
  metric_id = "${METRIC_ID}"
  metric_version = "1.2.3"
  metric_tags    = ["g1"]
}

resource "aws_cloudformation_stack" "metrics" {
  template_body = jsonencode({
    AWSTemplateFormatVersion = "2010-09-09"
    Description = "(\${local.metric_id})"
  })
}
`;

/** The misaligned `read.tf` the generators wrote. */
const MISALIGNED_READ = `locals {
  config_dir      = "\${path.module}/../runtime-config"
  entries_dir     = "\${local.config_dir}/entries"
  namespace_path  = "\${local.config_dir}/x.json"
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
    expect(fmt.options.command).toBe('terraform fmt -check -recursive -diff');
    expect(fmt.inputs).toEqual(['default']);
    expect(fmt.configurations.fix.command).toBe('terraform fmt -recursive');
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

  it('should realign the vended terraform files fmt would rewrite', async () => {
    tree.write(METRICS_PATH, MISALIGNED_METRICS);
    tree.write(READ_PATH, MISALIGNED_READ);

    await migration(tree);

    // `terraform fmt` aligns each block's assignments to a common width, so the
    // newly-checking target rejects these files until they match.
    expect(tree.read(METRICS_PATH, 'utf-8')).toContain(
      `metric_id      = "${METRIC_ID}"`,
    );
    expect(tree.read(METRICS_PATH, 'utf-8')).toContain(
      'Description              =',
    );
    const read = tree.read(READ_PATH, 'utf-8')!;
    expect(read).toContain('config_dir     =');
    expect(read).toContain('entries_dir    =');
    expect(read).toContain('namespace_path =');
    // The values themselves are untouched.
    expect(read).toContain('"${local.config_dir}/entries"');
  });

  it('should leave a metrics file it does not recognise alone', async () => {
    const own = 'locals {\n  metric_id = "mine"\n  metric_version = "1"\n}\n';
    tree.write(METRICS_PATH, own);

    await migration(tree);

    expect(tree.read(METRICS_PATH, 'utf-8')).toBe(own);
  });

  it('should be idempotent', async () => {
    addTerraformProject(tree);
    tree.write(METRICS_PATH, MISALIGNED_METRICS);
    tree.write(READ_PATH, MISALIGNED_READ);

    await migration(tree);
    const after = [
      tree.read('packages/tf-lib/project.json', 'utf-8'),
      tree.read(METRICS_PATH, 'utf-8'),
      tree.read(READ_PATH, 'utf-8'),
    ];

    const { nextSteps } = await migration(tree);

    expect([
      tree.read('packages/tf-lib/project.json', 'utf-8'),
      tree.read(METRICS_PATH, 'utf-8'),
      tree.read(READ_PATH, 'utf-8'),
    ]).toEqual(after);
    expect(nextSteps).toEqual([]);
  });
});
