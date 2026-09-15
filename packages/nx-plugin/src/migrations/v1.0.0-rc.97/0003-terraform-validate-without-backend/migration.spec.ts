/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  readProjectConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { terraformProjectGenerator } from '../../../terraform/project/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const PROJECT = '@proj/infra';
/** `packages/infra/src` is three levels below the root that holds `.terraform`. */
const EXPECTED_CACHE_DIR = '../../../.terraform/plugin-cache/{projectRoot}';
const EXPECTED_DATA_DIR = '../../../dist/{projectRoot}/terraform-validate';

/** The `validate` target as the pre-fix generator vended it. */
const preFixValidateTarget = () => ({
  executor: 'nx:run-commands',
  cache: true,
  inputs: ['default'],
  options: {
    command: 'terraform validate',
    forwardAllArgs: true,
    cwd: '{projectRoot}/src',
  },
  dependsOn: ['init'],
});

/**
 * Generates a terraform project, then reverts `validate` to the shape the
 * pre-fix generator produced — so the fixture is what users are upgrading from.
 */
const generatePreFixProject = async (
  tree: Tree,
  type: 'application' | 'library' = 'application',
) => {
  await terraformProjectGenerator(tree, {
    name: 'infra',
    type,
    directory: 'packages',
  });

  const config = readProjectConfiguration(tree, PROJECT);
  config.targets.validate = preFixValidateTarget() as never;
  updateProjectConfiguration(tree, PROJECT, config);
};

describe('terraform-validate-without-backend migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should be a no-op when the workspace has no terraform project', async () => {
    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
  });

  it('should start from a fixture that depends on init', async () => {
    // Guards the fixture: without this the assertions below could pass without
    // the migration doing anything.
    await generatePreFixProject(tree);

    const { validate } = readProjectConfiguration(tree, PROJECT).targets;
    expect(validate.dependsOn).toEqual(['init']);
    expect(validate.options.env).toBeUndefined();
  });

  it('should run its own backendless init rather than depending on init', async () => {
    await generatePreFixProject(tree);

    const result = await migration(tree);

    const { validate } = readProjectConfiguration(tree, PROJECT).targets;
    // The backend-configured `init` is what needed a bootstrapped state bucket.
    expect(validate.dependsOn).toBeUndefined();
    expect(validate.options.command).toBeUndefined();
    expect(validate.options.commands).toEqual([
      { command: `shx mkdir -p ${EXPECTED_CACHE_DIR}`, forwardAllArgs: false },
      'terraform init -backend=false',
      'terraform validate',
    ]);
    // `mkdir` and `init` have to complete before the next command runs.
    expect(validate.options.parallel).toBe(false);
    expect(validate.options.env).toEqual({
      TF_DATA_DIR: EXPECTED_DATA_DIR,
      TF_PLUGIN_CACHE_DIR: EXPECTED_CACHE_DIR,
    });
    // A consumed module changing must invalidate the result.
    expect(validate.inputs).toEqual(['default', '^production']);
    // The data dir is symlinks into the shared cache, so nothing to restore.
    expect(validate.outputs).toEqual([]);
    expect(validate.cache).toBe(true);
    expect(validate.options.cwd).toBe('{projectRoot}/src');
    expect(result.nextSteps).toEqual([]);
  });

  it('should migrate a library project the same way', async () => {
    await generatePreFixProject(tree, 'library');

    const result = await migration(tree);

    const { validate } = readProjectConfiguration(tree, PROJECT).targets;
    expect(validate.dependsOn).toBeUndefined();
    expect(validate.options.commands).toContain(
      'terraform init -backend=false',
    );
    expect(result.nextSteps).toEqual([]);
  });

  it('should leave a customised validate target untouched and report it', async () => {
    await generatePreFixProject(tree);

    const config = readProjectConfiguration(tree, PROJECT);
    config.targets.validate.options.command = 'terraform validate -json';
    updateProjectConfiguration(tree, PROJECT, config);

    const result = await migration(tree);

    const { validate } = readProjectConfiguration(tree, PROJECT).targets;
    expect(validate.options.command).toBe('terraform validate -json');
    expect(validate.dependsOn).toEqual(['init']);
    expect(result.nextSteps).toEqual([
      expect.stringContaining('@proj/infra:validate'),
    ]);
  });

  it('should leave a project this generator did not create alone', async () => {
    addProjectConfiguration(tree, '@proj/other', {
      root: 'packages/other',
      targets: { validate: preFixValidateTarget() } as never,
    });

    const result = await migration(tree);

    expect(
      readProjectConfiguration(tree, '@proj/other').targets.validate.dependsOn,
    ).toEqual(['init']);
    expect(result.nextSteps).toEqual([]);
  });

  it('should be idempotent', async () => {
    await generatePreFixProject(tree);

    await migration(tree);
    const afterFirst = readProjectConfiguration(tree, PROJECT).targets.validate;

    const result = await migration(tree);

    expect(readProjectConfiguration(tree, PROJECT).targets.validate).toEqual(
      afterFirst,
    );
    expect(result.nextSteps).toEqual([]);
  });

  it('should preserve user terraform code', async () => {
    await generatePreFixProject(tree);

    const mainPath = 'packages/infra/src/main.tf';
    const userMain = `resource "aws_sns_topic" "mine" {
  name = "mine"
}
`;
    tree.write(mainPath, userMain);

    await migration(tree);

    expect(tree.read(mainPath, 'utf-8')).toBe(userMain);
  });
});
