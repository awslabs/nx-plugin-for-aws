/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  readProjectConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { terraformProjectGenerator } from '../../../terraform/project/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const PROJECT = '@proj/infra';
const TERRAFORM_INIT = 'terraform-init';
const DEPENDENT_TARGETS = ['init', 'test', 'validate'];
/** `packages/infra/src` is three levels below the root that holds `.terraform`. */
const CACHE_DIR = '../../../.terraform/plugin-cache/{projectRoot}';
const dataDir = (name: string) => `../../../dist/{projectRoot}/${name}`;

const generateProject = (tree: Tree, type: 'application' | 'library') =>
  terraformProjectGenerator(tree, {
    name: 'infra',
    type,
    directory: 'packages',
  });

/**
 * Generates a terraform project, then reverts what this migration adds back to
 * the shape the pre-fix generator produced: `test` and `validate` ran their own
 * backendless `terraform init` into a `TF_DATA_DIR` of their own, behind the
 * `shx mkdir` the plugin-cache fix added.
 */
const generatePreFixProject = async (
  tree: Tree,
  type: 'application' | 'library' = 'application',
) => {
  await generateProject(tree, type);

  const config = readProjectConfiguration(tree, PROJECT);
  delete config.targets[TERRAFORM_INIT];
  for (const targetName of DEPENDENT_TARGETS) {
    const target = config.targets[targetName];
    const dependsOn = (target.dependsOn ?? []).filter(
      (dependency) => dependency !== TERRAFORM_INIT,
    );
    if (dependsOn.length > 0) {
      target.dependsOn = dependsOn;
    } else {
      delete target.dependsOn;
    }
  }
  for (const verb of ['test', 'validate'] as const) {
    const target = config.targets[verb];
    delete target.options.command;
    target.options.commands = [
      { command: `shx mkdir -p ${CACHE_DIR}`, forwardAllArgs: false },
      'terraform init -backend=false',
      `terraform ${verb}`,
    ];
    target.options.parallel = false;
    target.options.env = {
      TF_DATA_DIR: dataDir(`terraform-${verb}`),
      TF_PLUGIN_CACHE_DIR: CACHE_DIR,
    };
  }
  updateProjectConfiguration(tree, PROJECT, config);
};

/** The project as today's generator produces it, in its own tree. */
const generatedTargets = async (type: 'application' | 'library') => {
  const tree = createTreeUsingTsSolutionSetup();
  await generateProject(tree, type);
  return readProjectConfiguration(tree, PROJECT).targets;
};

describe('terraform-init-target migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should be a no-op when the workspace has no terraform project', async () => {
    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
  });

  it('should start from a fixture that lacks the target', async () => {
    // Guards the fixture: without this the assertions below could pass without
    // the migration doing anything.
    await generatePreFixProject(tree);

    const { targets } = readProjectConfiguration(tree, PROJECT);
    expect(targets[TERRAFORM_INIT]).toBeUndefined();
    for (const targetName of DEPENDENT_TARGETS) {
      expect(targets[targetName].dependsOn ?? []).not.toContain(TERRAFORM_INIT);
    }
    expect(targets.test.options.commands).toContain(
      'terraform init -backend=false',
    );
  });

  it.each(['application', 'library'] as const)(
    'should converge a %s project on the shape the generator produces',
    async (type) => {
      await generatePreFixProject(tree, type);

      const result = await migration(tree);

      const { targets } = readProjectConfiguration(tree, PROJECT);
      const expected = await generatedTargets(type);
      expect(targets).toEqual(expected);
      // Sorted the way the generator sorts them, so the two are the same file.
      expect(Object.keys(targets)).toEqual(Object.keys(expected));
      expect(result.nextSteps).toEqual([]);
    },
  );

  it('should install the providers without credentials or the backend', async () => {
    await generatePreFixProject(tree);

    await migration(tree);

    const target = readProjectConfiguration(tree, PROJECT).targets[
      TERRAFORM_INIT
    ];
    expect(target.options.commands).toEqual([
      { command: `shx mkdir -p ${CACHE_DIR}`, forwardAllArgs: false },
      'terraform init -backend=false',
    ]);
    expect(target.options.env).toEqual({
      TF_DATA_DIR: dataDir(TERRAFORM_INIT),
      TF_PLUGIN_CACHE_DIR: CACHE_DIR,
    });
    // `mkdir` has to complete before `terraform init` reads the cache.
    expect(target.options.parallel).toBe(false);
    // A cache hit on another machine would report success over an empty cache
    // and hand the race back to the targets that depend on this one.
    expect(target.cache).toBeUndefined();
  });

  it('should stop test and validate running their own init', async () => {
    await generatePreFixProject(tree);

    await migration(tree);

    const { targets } = readProjectConfiguration(tree, PROJECT);
    for (const verb of ['test', 'validate'] as const) {
      const target = targets[verb];
      expect(target.options.command).toBe(`terraform ${verb}`);
      expect(target.options.commands).toBeUndefined();
      // The `TF_DATA_DIR` `terraform-init` prepared, rather than one of its own.
      expect(target.options.env).toEqual({
        TF_DATA_DIR: dataDir(TERRAFORM_INIT),
      });
      // Sequenced the init ahead of the command; there is one command left.
      expect(target.options.parallel).toBeUndefined();
      expect(target.dependsOn).toEqual([TERRAFORM_INIT]);
    }
  });

  it('should order every target that needs the providers after it', async () => {
    await generatePreFixProject(tree);

    await migration(tree);

    const { targets } = readProjectConfiguration(tree, PROJECT);
    for (const targetName of DEPENDENT_TARGETS) {
      expect(targets[targetName].dependsOn).toContain(TERRAFORM_INIT);
    }
    // An application's `init` keeps its own backend-configured init, and the
    // dependency on its dependencies' init.
    expect(targets.init.dependsOn).toEqual([TERRAFORM_INIT, '^init']);
    expect(targets.init.options.commands).toEqual([
      'tsx {projectRoot}/scripts/init.ts {projectRoot}',
    ]);
  });

  it('should report a target that has taken on another command', async () => {
    await generatePreFixProject(tree);
    const config = readProjectConfiguration(tree, PROJECT);
    config.targets.validate.options.commands = [
      'terraform init -backend=false',
      './scripts/my-checks.sh',
      'terraform validate',
    ];
    updateProjectConfiguration(tree, PROJECT, config);

    const result = await migration(tree);

    const { targets } = readProjectConfiguration(tree, PROJECT);
    expect(targets.validate.dependsOn).toBeUndefined();
    expect(targets.validate.options.commands).toContain(
      './scripts/my-checks.sh',
    );
    expect(result.nextSteps).toEqual([
      expect.stringContaining("its 'validate' target no longer matches"),
    ]);
    // The targets it does recognise are still migrated.
    expect(targets.test.dependsOn).toContain(TERRAFORM_INIT);
  });

  it('should report a target pointed at a data dir of its own choosing', async () => {
    await generatePreFixProject(tree);
    const config = readProjectConfiguration(tree, PROJECT);
    config.targets.test.options.env.TF_DATA_DIR = '/mnt/shared/terraform-test';
    updateProjectConfiguration(tree, PROJECT, config);

    const result = await migration(tree);

    const { targets } = readProjectConfiguration(tree, PROJECT);
    expect(targets.test.options.env.TF_DATA_DIR).toBe(
      '/mnt/shared/terraform-test',
    );
    expect(targets.test.dependsOn).toBeUndefined();
    expect(result.nextSteps).toEqual([
      expect.stringContaining("its 'test' target no longer matches"),
    ]);
  });

  it('should preserve env vars and a dependsOn a user has added', async () => {
    await generatePreFixProject(tree);
    const config = readProjectConfiguration(tree, PROJECT);
    config.targets.test.dependsOn = ['my-fixtures'];
    config.targets.test.options.env.TF_LOG = 'debug';
    updateProjectConfiguration(tree, PROJECT, config);

    await migration(tree);

    const { test } = readProjectConfiguration(tree, PROJECT).targets;
    expect(test.dependsOn).toEqual([TERRAFORM_INIT, 'my-fixtures']);
    expect(test.options.env).toEqual({
      TF_LOG: 'debug',
      TF_DATA_DIR: dataDir(TERRAFORM_INIT),
    });
  });

  it('should be idempotent', async () => {
    await generatePreFixProject(tree);

    await migration(tree);
    const afterFirstRun = readProjectConfiguration(tree, PROJECT);

    const result = await migration(tree);

    expect(readProjectConfiguration(tree, PROJECT)).toEqual(afterFirstRun);
    expect(result.nextSteps).toEqual([]);
  });

  it('should leave a project it did not generate alone', async () => {
    await generatePreFixProject(tree);
    const config = readProjectConfiguration(tree, PROJECT);
    delete (config.metadata as { generator?: string }).generator;
    updateProjectConfiguration(tree, PROJECT, config);

    const result = await migration(tree);

    expect(
      readProjectConfiguration(tree, PROJECT).targets[TERRAFORM_INIT],
    ).toBeUndefined();
    expect(result.nextSteps).toEqual([]);
  });
});
