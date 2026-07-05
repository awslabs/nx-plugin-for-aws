/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, readNxJson, type Tree } from '@nx/devkit';
import uniqBy from 'lodash.uniqby';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { TS_LIB_GENERATOR_INFO, tsProjectGenerator } from './generator';

describe('ts lib generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should generate library with default options', async () => {
    await tsProjectGenerator(tree, {
      name: 'test-lib',
      preferInstallDependencies: false,
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
      preferInstallDependencies: false,
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
      preferInstallDependencies: false,
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

  it('should use default subdirectory when subDirectory is empty string', async () => {
    await tsProjectGenerator(tree, {
      name: 'test-lib',
      directory: 'feature',
      subDirectory: '', // Empty string should fall back to normalized name
      preferInstallDependencies: false,
    });
    // Verify directory structure - should use normalized name (test-lib) as subdirectory
    expect(tree.exists('feature/test-lib')).toBeTruthy();
    expect(tree.exists('feature/test-lib/src')).toBeTruthy();
    expect(tree.exists('feature/test-lib/src/index.ts')).toBeTruthy();
  });

  it('should not configure duplicate @nx/js/typescript plugin entries', async () => {
    await tsProjectGenerator(tree, {
      name: 'test-1',
      preferInstallDependencies: false,
    });
    await tsProjectGenerator(tree, {
      name: 'test-2',
      preferInstallDependencies: false,
    });

    const jsPlugins = readNxJson(tree).plugins.filter(
      (p) => typeof p !== 'string' && p.plugin === '@nx/js/typescript',
    );
    expect(jsPlugins).toHaveLength(1);
  });

  it('should configure named inputs in nx.json', async () => {
    await tsProjectGenerator(tree, {
      name: 'test-1',
      preferInstallDependencies: false,
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
      preferInstallDependencies: false,
    });

    await tsProjectGenerator(tree, {
      name: 'test-2',
      preferInstallDependencies: false,
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
      preferInstallDependencies: false,
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
      preferInstallDependencies: false,
    });

    await tsProjectGenerator(tree, {
      name: 'test-2',
      preferInstallDependencies: false,
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
      preferInstallDependencies: false,
    });

    expect(readJson(tree, 'test-lib/project.json').metadata).toHaveProperty(
      'generator',
      TS_LIB_GENERATOR_INFO.id,
    );
  });

  it('should create vitest.config.mts', async () => {
    // Call the generator function
    await tsProjectGenerator(tree, {
      name: 'test-lib',
      preferInstallDependencies: false,
    });

    // No vite configuration as we build with tsc
    expect(tree.exists('test-lib/vite.config.mts')).toBeFalsy();
    expect(tree.exists('test-lib/vite.config.ts')).toBeFalsy();

    // vitest.config.mts is used for test configuration
    expect(tree.exists('test-lib/vitest.config.mts')).toBeTruthy();
  });

  it('should add generator metric to app.ts', async () => {
    // Set up test tree with shared constructs
    await sharedConstructsGenerator(tree, { iac: 'cdk' });

    // Call the generator function
    await tsProjectGenerator(tree, {
      name: 'test-lib',
      preferInstallDependencies: false,
    });

    // Verify the metric was added to app.ts
    expectHasMetricTags(tree, TS_LIB_GENERATOR_INFO.metric);
  });

  it('should be idempotent when re-run with same options', async () => {
    await tsProjectGenerator(tree, {
      name: 'test-lib',
      preferInstallDependencies: false,
    });

    // User edits the generated source
    const indexPath = 'test-lib/src/index.ts';
    tree.write(indexPath, '// my code\n');

    const targetsBefore = readJson(tree, 'test-lib/project.json').targets;

    // Re-running with the same options must not throw, must preserve user code,
    // and must not change the project's targets.
    await expect(
      tsProjectGenerator(tree, {
        name: 'test-lib',
        preferInstallDependencies: false,
      }),
    ).resolves.toBeDefined();

    expect(tree.read(indexPath, 'utf-8')).toBe('// my code\n');
    expect(readJson(tree, 'test-lib/project.json').targets).toEqual(
      targetsBefore,
    );
  });

  it('should mark the workspace as ESM by default', async () => {
    await tsProjectGenerator(tree, {
      name: 'test-lib',
      preferInstallDependencies: false,
    });
    expect(readJson(tree, 'package.json').type).toBe('module');
    // ESM leaves the @nx/js-generated tsconfig module settings in place (it
    // does not force a CommonJS module system).
    expect(
      readJson(tree, 'test-lib/tsconfig.lib.json').compilerOptions?.module,
    ).not.toBe('node16');
  });

  it('should configure the project for CommonJS when module=cjs', async () => {
    await tsProjectGenerator(tree, {
      name: 'test-lib',
      module: 'cjs',
      preferInstallDependencies: false,
    });
    // CommonJS workspaces are marked with an explicit `type: commonjs`.
    expect(readJson(tree, 'package.json').type).toBe('commonjs');
    const compilerOptions = readJson(tree, 'test-lib/tsconfig.lib.json')
      .compilerOptions;
    expect(compilerOptions?.module).toBe('node16');
    expect(compilerOptions?.moduleResolution).toBe('node16');
  });

  it('should infer CommonJS from an existing commonjs workspace', async () => {
    // First project sets the workspace to CommonJS.
    await tsProjectGenerator(tree, {
      name: 'first-lib',
      module: 'cjs',
      preferInstallDependencies: false,
    });
    // A subsequent project with the default (infer) follows suit.
    await tsProjectGenerator(tree, {
      name: 'second-lib',
      preferInstallDependencies: false,
    });
    expect(readJson(tree, 'package.json').type).toBe('commonjs');
    expect(
      readJson(tree, 'second-lib/tsconfig.lib.json').compilerOptions?.module,
    ).toBe('node16');
  });
});
