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
const INSTALL_PROVIDERS = 'install-providers';
const DEPENDENT_TARGETS = ['init', 'test', 'validate'];

const generateProject = (tree: Tree, type: 'application' | 'library') =>
  terraformProjectGenerator(tree, {
    name: 'infra',
    type,
    directory: 'packages',
  });

/**
 * Generates a terraform project, then reverts what this migration adds back to
 * the shape the pre-fix generator produced.
 */
const generatePreFixProject = async (
  tree: Tree,
  type: 'application' | 'library' = 'application',
) => {
  await generateProject(tree, type);

  const config = readProjectConfiguration(tree, PROJECT);
  delete config.targets[INSTALL_PROVIDERS];
  for (const targetName of DEPENDENT_TARGETS) {
    const target = config.targets[targetName];
    const dependsOn = (target.dependsOn ?? []).filter(
      (dependency) => dependency !== INSTALL_PROVIDERS,
    );
    if (dependsOn.length > 0) {
      target.dependsOn = dependsOn;
    } else {
      delete target.dependsOn;
    }
  }
  updateProjectConfiguration(tree, PROJECT, config);
};

/** The project as today's generator produces it, in its own tree. */
const generatedTargets = async (type: 'application' | 'library') => {
  const tree = createTreeUsingTsSolutionSetup();
  await generateProject(tree, type);
  return readProjectConfiguration(tree, PROJECT).targets;
};

describe('terraform-install-providers-target migration', () => {
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
    expect(targets[INSTALL_PROVIDERS]).toBeUndefined();
    for (const targetName of DEPENDENT_TARGETS) {
      expect(targets[targetName].dependsOn ?? []).not.toContain(
        INSTALL_PROVIDERS,
      );
    }
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
      INSTALL_PROVIDERS
    ];
    // `packages/infra/src` is three levels below the root that holds `.terraform`.
    const cacheDir = '../../../.terraform/plugin-cache/{projectRoot}';
    expect(target.options.commands).toEqual([
      { command: `shx mkdir -p ${cacheDir}`, forwardAllArgs: false },
      'terraform init -backend=false',
    ]);
    expect(target.options.env).toEqual({
      TF_DATA_DIR: '../../../dist/{projectRoot}/terraform-providers',
      TF_PLUGIN_CACHE_DIR: cacheDir,
    });
    // `mkdir` has to complete before `terraform init` reads the cache.
    expect(target.options.parallel).toBe(false);
    // A cache hit on another machine would report success over an empty cache
    // and hand the race back to the targets that depend on this one.
    expect(target.cache).toBeUndefined();
  });

  it('should order every target that runs terraform init after it', async () => {
    await generatePreFixProject(tree);

    await migration(tree);

    const { targets } = readProjectConfiguration(tree, PROJECT);
    for (const targetName of DEPENDENT_TARGETS) {
      expect(targets[targetName].dependsOn).toContain(INSTALL_PROVIDERS);
    }
    // An application's `init` keeps the dependency on its dependencies' init.
    expect(targets.init.dependsOn).toEqual([INSTALL_PROVIDERS, '^init']);
  });

  it('should report a target whose commands no longer run terraform init', async () => {
    await generatePreFixProject(tree);
    const config = readProjectConfiguration(tree, PROJECT);
    config.targets.validate.options.commands = ['./scripts/my-validate.sh'];
    updateProjectConfiguration(tree, PROJECT, config);

    const result = await migration(tree);

    const { targets } = readProjectConfiguration(tree, PROJECT);
    expect(targets.validate.dependsOn).toBeUndefined();
    expect(targets.validate.options.commands).toEqual([
      './scripts/my-validate.sh',
    ]);
    expect(result.nextSteps).toEqual([
      expect.stringContaining("its 'validate' target no longer matches"),
    ]);
    // The targets it does recognise are still migrated.
    expect(targets.test.dependsOn).toContain(INSTALL_PROVIDERS);
  });

  it('should preserve a dependsOn a user has added', async () => {
    await generatePreFixProject(tree);
    const config = readProjectConfiguration(tree, PROJECT);
    config.targets.test.dependsOn = ['my-fixtures'];
    updateProjectConfiguration(tree, PROJECT, config);

    await migration(tree);

    expect(
      readProjectConfiguration(tree, PROJECT).targets.test.dependsOn,
    ).toEqual([INSTALL_PROVIDERS, 'my-fixtures']);
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
      readProjectConfiguration(tree, PROJECT).targets[INSTALL_PROVIDERS],
    ).toBeUndefined();
    expect(result.nextSteps).toEqual([]);
  });
});
