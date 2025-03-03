/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readNxJson, Tree } from '@nx/devkit';
import { tsLibGenerator } from './generator';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
describe('ts lib generator', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });
  it('should generate library with default options', async () => {
    await tsLibGenerator(tree, {
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
  });
  it('should generate library with custom directory', async () => {
    await tsLibGenerator(tree, {
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
    await tsLibGenerator(tree, {
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
    await tsLibGenerator(tree, {
      name: 'test-1',
      skipInstall: true,
    });
    await tsLibGenerator(tree, {
      name: 'test-2',
      skipInstall: true,
    });

    const jsPlugins = readNxJson(tree).plugins.filter(
      (p) => typeof p !== 'string' && p.plugin === '@nx/js/typescript',
    );
    expect(jsPlugins).toHaveLength(1);
  });
});
