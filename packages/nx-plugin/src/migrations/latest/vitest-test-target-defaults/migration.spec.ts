/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  type NxJsonConfiguration,
  readNxJson,
  type TargetDefaults,
  type Tree,
  updateNxJson,
} from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

/** The block the generators wrote under the removed executor's key. */
const LEGACY_VITEST_DEFAULTS = {
  cache: true,
  inputs: ['default', '^production'],
  configurations: { 'update-snapshot': { args: '--update' } },
};

/** The catch-all `test` default the generators write. */
const TEST_CATCH_ALL = { dependsOn: ['^build'], inputs: ['default'] };

/** The `targetDefaults.test` entry this migration writes for the plugin. */
const VITEST_ENTRY = {
  filter: { plugin: '@nx/vitest' },
  ...LEGACY_VITEST_DEFAULTS,
};

/** Replace the tree's nx.json `targetDefaults`. */
const writeTargetDefaults = (tree: Tree, targetDefaults: TargetDefaults) =>
  updateNxJson(tree, { ...readNxJson(tree), targetDefaults });

/** Replace the tree's nx.json `plugins`. */
const writePlugins = (tree: Tree, plugins: NxJsonConfiguration['plugins']) =>
  updateNxJson(tree, { ...readNxJson(tree), plugins });

/** Add a project, with a vitest config file when `config` names one. */
const addProject = (tree: Tree, name: string, config?: string) => {
  addProjectConfiguration(tree, name, { root: `packages/${name}` });
  if (config) {
    tree.write(`packages/${name}/${config}`, 'export default {};\n');
  }
};

/**
 * The state `nx migrate 24.x` leaves a ts#project workspace in: the
 * `@nx/vitest` plugin registered, a vitest project, and no
 * `@nx/vitest:test` key.
 */
const setUpVitestWorkspaceWithoutLegacyKey = (tree: Tree) => {
  writePlugins(tree, [
    { plugin: '@nx/vitest', options: { testTargetName: 'test' } },
  ]);
  addProject(tree, 'lib', 'vitest.config.mts');
  writeTargetDefaults(tree, {
    build: { cache: true },
    test: TEST_CATCH_ALL,
  });
};

/** The `targetDefaults.test` entry filtered to the `@nx/vitest` plugin. */
const vitestEntry = (tree: Tree) =>
  [readNxJson(tree).targetDefaults.test]
    .flat()
    .find((entry) => entry.filter?.plugin === '@nx/vitest');

describe('vitest-test-target-defaults migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should move the vended block onto the filtered test entry', async () => {
    writeTargetDefaults(tree, {
      build: { cache: true },
      test: TEST_CATCH_ALL,
      '@nx/vitest:test': LEGACY_VITEST_DEFAULTS,
    });

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    const targetDefaults = readNxJson(tree).targetDefaults;
    expect(targetDefaults).not.toHaveProperty(['@nx/vitest:test']);
    expect(targetDefaults.test).toEqual([TEST_CATCH_ALL, VITEST_ENTRY]);
  });

  it('should leave nx.json untouched when it has no @nx/vitest:test key and no vitest project', async () => {
    writeTargetDefaults(tree, {
      test: { dependsOn: ['^build'], inputs: ['default'] },
    });
    const before = tree.read('nx.json', 'utf-8');

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    expect(tree.read('nx.json', 'utf-8')).toBe(before);
  });

  it('should do nothing when the workspace has no nx.json', async () => {
    tree.delete('nx.json');

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    expect(tree.exists('nx.json')).toBe(false);
  });

  it('should carry a customised block onto the filtered test entry', async () => {
    writeTargetDefaults(tree, {
      test: { dependsOn: ['^build'], inputs: ['default'] },
      '@nx/vitest:test': {
        cache: true,
        inputs: ['default'],
        configurations: {
          'update-snapshot': { args: '--update' },
          ci: { args: '--reporter=junit' },
        },
      },
    });

    await migration(tree);

    expect(vitestEntry(tree)).toEqual({
      filter: { plugin: '@nx/vitest' },
      cache: true,
      inputs: ['default'],
      configurations: {
        'update-snapshot': { args: '--update' },
        ci: { args: '--reporter=junit' },
      },
    });
  });

  it('should keep the values of an existing filtered @nx/vitest test entry', async () => {
    writeTargetDefaults(tree, {
      test: [
        { dependsOn: ['^build'] },
        { filter: { plugin: '@nx/vitest' }, inputs: ['custom'] },
      ],
      '@nx/vitest:test': LEGACY_VITEST_DEFAULTS,
    });

    await migration(tree);

    expect(readNxJson(tree).targetDefaults.test).toEqual([
      { dependsOn: ['^build'] },
      {
        filter: { plugin: '@nx/vitest' },
        cache: true,
        inputs: ['custom'],
        configurations: { 'update-snapshot': { args: '--update' } },
      },
    ]);
  });

  it('should skip and report the array form of the @nx/vitest:test key', async () => {
    writeTargetDefaults(tree, {
      test: { dependsOn: ['^build'] },
      '@nx/vitest:test': [{ filter: { projects: ['tag:app'] }, cache: true }],
    });
    const before = tree.read('nx.json', 'utf-8');

    const { nextSteps } = await migration(tree);

    expect(tree.read('nx.json', 'utf-8')).toBe(before);
    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0]).toContain("targetDefaults['@nx/vitest:test']");
  });

  it('should be idempotent', async () => {
    writeTargetDefaults(tree, {
      test: { dependsOn: ['^build'], inputs: ['default'] },
      '@nx/vitest:test': LEGACY_VITEST_DEFAULTS,
    });

    await migration(tree);
    const once = tree.read('nx.json', 'utf-8');
    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    expect(tree.read('nx.json', 'utf-8')).toBe(once);
  });

  it('should leave the other target defaults untouched', async () => {
    const others: TargetDefaults = {
      build: { cache: true, inputs: ['default'] },
      lint: [{ cache: true }, { filter: { projects: ['a'] }, cache: false }],
      'e2e-*': { dependsOn: ['build'] },
    };
    writeTargetDefaults(tree, {
      ...others,
      test: { dependsOn: ['^build'], inputs: ['default'] },
      '@nx/vitest:test': LEGACY_VITEST_DEFAULTS,
    });

    await migration(tree);

    const { test: _test, ...rest } = readNxJson(tree).targetDefaults;
    expect(rest).toEqual(others);
  });
  describe('when nx migrate has already removed the @nx/vitest:test key', () => {
    beforeEach(() => {
      setUpVitestWorkspaceWithoutLegacyKey(tree);
    });

    it('should add the vitest test defaults', async () => {
      const { nextSteps } = await migration(tree);

      expect(nextSteps).toEqual([]);
      const targetDefaults = readNxJson(tree).targetDefaults;
      expect(targetDefaults.build).toEqual({ cache: true });
      expect(targetDefaults.test).toEqual([TEST_CATCH_ALL, VITEST_ENTRY]);
    });

    it('should add the vitest entry as the only test default when there is no test default', async () => {
      writeTargetDefaults(tree, { build: { cache: true } });

      const { nextSteps } = await migration(tree);

      expect(nextSteps).toEqual([]);
      expect(readNxJson(tree).targetDefaults).toEqual({
        build: { cache: true },
        test: [VITEST_ENTRY],
      });
    });

    it('should detect a project with a vite.config.mts', async () => {
      tree.delete('packages/lib/vitest.config.mts');
      tree.write('packages/lib/vite.config.mts', 'export default {};\n');

      await migration(tree);

      expect(vitestEntry(tree)).toEqual(VITEST_ENTRY);
    });

    it('should detect the plugin registered as a string', async () => {
      writePlugins(tree, ['@nx/vitest']);

      await migration(tree);

      expect(vitestEntry(tree)).toEqual(VITEST_ENTRY);
    });

    it('should leave an existing filtered @nx/vitest test entry as it is', async () => {
      writeTargetDefaults(tree, {
        test: [
          TEST_CATCH_ALL,
          { filter: { plugin: '@nx/vitest' }, inputs: ['custom'] },
        ],
      });
      const before = tree.read('nx.json', 'utf-8');

      const { nextSteps } = await migration(tree);

      expect(nextSteps).toEqual([]);
      expect(tree.read('nx.json', 'utf-8')).toBe(before);
    });

    it('should be idempotent', async () => {
      await migration(tree);
      const once = tree.read('nx.json', 'utf-8');
      const { nextSteps } = await migration(tree);

      expect(nextSteps).toEqual([]);
      expect(tree.read('nx.json', 'utf-8')).toBe(once);
    });

    it('should do nothing when no project has a vitest config', async () => {
      tree.delete('packages/lib/vitest.config.mts');
      addProject(tree, 'py-lib');
      const before = tree.read('nx.json', 'utf-8');

      const { nextSteps } = await migration(tree);

      expect(nextSteps).toEqual([]);
      expect(tree.read('nx.json', 'utf-8')).toBe(before);
    });

    it('should do nothing when the @nx/vitest plugin is not registered', async () => {
      writePlugins(tree, [{ plugin: '@nx/vite/plugin', options: {} }]);
      const before = tree.read('nx.json', 'utf-8');

      const { nextSteps } = await migration(tree);

      expect(nextSteps).toEqual([]);
      expect(tree.read('nx.json', 'utf-8')).toBe(before);
    });
  });
});
