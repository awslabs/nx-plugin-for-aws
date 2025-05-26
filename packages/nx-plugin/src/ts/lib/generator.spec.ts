/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, readNxJson, Tree } from '@nx/devkit';
import { TS_LIB_GENERATOR_INFO, tsProjectGenerator } from './generator';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import uniqBy from 'lodash.uniqby';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { expectHasMetricTags } from '../../utils/metrics.spec';

describe('ts lib generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should generate library with default options', async () => {
    await tsProjectGenerator(tree, {
      name: 'test-lib',
      skipInstall: true,
    });
    // Verify directory structure
    expect(tree.exists('test-lib')).toBeTruthy();
    expect(tree.exists('test-lib/src')).toBeTruthy();
    expect(tree.exists('test-lib/src/index.ts')).toBeTruthy();
    expect(tree.exists('test-lib/tsconfig.json')).toBeTruthy();
    expect(tree.exists('test-lib/project.json')).toBeTruthy();
    // Create snapshots of generated files
    expect(tree.read('test-lib/src/index.ts', 'utf-8')).toMatchSnapshot(
      'index.ts',
    );
    expect(tree.read('test-lib/tsconfig.json', 'utf-8')).toMatchSnapshot(
      'tsconfig.json',
    );
    expect(tree.read('test-lib/project.json', 'utf-8')).toMatchSnapshot(
      'project.json',
    );
    expect(tree.read('test-lib/eslint.config.mjs', 'utf-8')).toMatchSnapshot(
      'eslint.config.mjs',
    );
  });

  it('should generate library with custom directory', async () => {
    await tsProjectGenerator(tree, {
      name: 'test-lib',
      directory: 'libs',
      skipInstall: true,
    });
    // Verify directory structure
    expect(tree.exists('libs/test-lib')).toBeTruthy();
    expect(tree.exists('libs/test-lib/src')).toBeTruthy();
    expect(tree.exists('libs/test-lib/src/index.ts')).toBeTruthy();
    // Create snapshots of generated files
    expect(tree.read('libs/test-lib/src/index.ts', 'utf-8')).toMatchSnapshot(
      'custom-dir-index.ts',
    );
    expect(tree.read('libs/test-lib/tsconfig.json', 'utf-8')).toMatchSnapshot(
      'custom-dir-tsconfig.json',
    );
    expect(tree.read('libs/test-lib/project.json', 'utf-8')).toMatchSnapshot(
      'custom-dir-project.json',
    );
  });

  it('should generate library with subdirectory', async () => {
    await tsProjectGenerator(tree, {
      name: 'test-lib',
      subDirectory: 'test-lib',
      directory: 'feature',
      skipInstall: true,
    });
    // Verify directory structure
    expect(tree.exists('feature/test-lib')).toBeTruthy();
    expect(tree.exists('feature/test-lib/src')).toBeTruthy();
    expect(tree.exists('feature/test-lib/src/index.ts')).toBeTruthy();
    // Create snapshots of generated files
    expect(tree.read('feature/test-lib/src/index.ts', 'utf-8')).toMatchSnapshot(
      'subdir-index.ts',
    );
    expect(
      tree.read('feature/test-lib/tsconfig.json', 'utf-8'),
    ).toMatchSnapshot('subdir-tsconfig.json');
    expect(tree.read('feature/test-lib/project.json', 'utf-8')).toMatchSnapshot(
      'subdir-project.json',
    );
  });

  it('should not configure duplicate @nx/js/typescript plugin entries', async () => {
    await tsProjectGenerator(tree, {
      name: 'test-1',
      skipInstall: true,
    });
    await tsProjectGenerator(tree, {
      name: 'test-2',
      skipInstall: true,
    });

    const jsPlugins = readNxJson(tree).plugins.filter(
      (p) => typeof p !== 'string' && p.plugin === '@nx/js/typescript',
    );
    expect(jsPlugins).toHaveLength(1);
  });

  it('should configure named inputs in nx.json', async () => {
    await tsProjectGenerator(tree, {
      name: 'test-1',
      skipInstall: true,
    });

    const namedInputs = readNxJson(tree).namedInputs;
    expect(namedInputs?.default).toBeDefined();

    expect(namedInputs.default).toContainEqual({
      dependentTasksOutputFiles: '**/*',
      transitive: true,
    });

    expect(tree.read('nx.json', 'utf-8')).toMatchSnapshot();
  });

  it('should not duplicate named inputs in nx.json', async () => {
    await tsProjectGenerator(tree, {
      name: 'test-1',
      skipInstall: true,
    });

    await tsProjectGenerator(tree, {
      name: 'test-2',
      skipInstall: true,
    });

    const namedInputs = readNxJson(tree).namedInputs;
    expect(namedInputs?.default).toBeDefined();

    expect(namedInputs.default).toHaveLength(
      uniqBy(namedInputs.default, (x) => x).length,
    );
  });

  it('should configure target defaults in nx.json', async () => {
    await tsProjectGenerator(tree, {
      name: 'test-1',
      skipInstall: true,
    });

    const targetDefaults = readNxJson(tree).targetDefaults;
    expect(targetDefaults?.build).toBeDefined();
    expect(targetDefaults?.compile).toBeDefined();
    expect(targetDefaults?.test).toBeDefined();

    expect(targetDefaults.build.cache).toBe(true);
    expect(targetDefaults.compile.cache).toBe(true);

    expect(targetDefaults.build.inputs).toContain('default');
    expect(targetDefaults.compile.inputs).toContain('default');
    expect(targetDefaults.test.inputs).toContain('default');
  });

  it('should not configure duplicate inputs in nx.json target defaults', async () => {
    await tsProjectGenerator(tree, {
      name: 'test-1',
      skipInstall: true,
    });

    await tsProjectGenerator(tree, {
      name: 'test-2',
      skipInstall: true,
    });

    const targetDefaults = readNxJson(tree).targetDefaults;

    expect(targetDefaults.build.inputs).toHaveLength(
      uniqBy(targetDefaults.build.inputs, (x) => x).length,
    );
    expect(targetDefaults.compile.inputs).toHaveLength(
      uniqBy(targetDefaults.compile.inputs, (x) => x).length,
    );
    expect(targetDefaults.test.inputs).toHaveLength(
      uniqBy(targetDefaults.test.inputs, (x) => x).length,
    );
  });

  it('should add generator to project metadata', async () => {
    // Call the generator function
    await tsProjectGenerator(tree, {
      name: 'test-lib',
      skipInstall: true,
    });

    expect(readJson(tree, 'test-lib/project.json').metadata).toHaveProperty(
      'generator',
      TS_LIB_GENERATOR_INFO.id,
    );
  });

  it('should add generator metric to app.ts', async () => {
    // Set up test tree with shared constructs
    await sharedConstructsGenerator(tree);

    // Call the generator function
    await tsProjectGenerator(tree, {
      name: 'test-lib',
      skipInstall: true,
    });

    // Verify the metric was added to app.ts
    expectHasMetricTags(tree, TS_LIB_GENERATOR_INFO.metric);
  });
});
