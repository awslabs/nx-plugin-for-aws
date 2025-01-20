/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from 'nx/src/devkit-testing-exports';
import { tsLibGenerator, getTsLibDetails } from './generator';
describe('ts lib generator', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });
  it('should generate library with default options', async () => {
    await tsLibGenerator(tree, {
      name: 'test-lib',
      unitTestRunner: 'vitest',
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
      'index.ts'
    );
    expect(tree.read('test-lib/tsconfig.json', 'utf-8')).toMatchSnapshot(
      'tsconfig.json'
    );
    expect(tree.read('test-lib/project.json', 'utf-8')).toMatchSnapshot(
      'project.json'
    );
  });
  it('should generate library with custom directory', async () => {
    await tsLibGenerator(tree, {
      name: 'test-lib',
      directory: 'libs',
      unitTestRunner: 'vitest',
      skipInstall: true,
    });
    // Verify directory structure
    expect(tree.exists('libs/test-lib')).toBeTruthy();
    expect(tree.exists('libs/test-lib/src')).toBeTruthy();
    expect(tree.exists('libs/test-lib/src/index.ts')).toBeTruthy();
    // Create snapshots of generated files
    expect(tree.read('libs/test-lib/src/index.ts', 'utf-8')).toMatchSnapshot(
      'custom-dir-index.ts'
    );
    expect(tree.read('libs/test-lib/tsconfig.json', 'utf-8')).toMatchSnapshot(
      'custom-dir-tsconfig.json'
    );
    expect(tree.read('libs/test-lib/project.json', 'utf-8')).toMatchSnapshot(
      'custom-dir-project.json'
    );
  });
  it('should generate library with custom scope', async () => {
    await tsLibGenerator(tree, {
      name: 'test-lib',
      scope: '@custom',
      unitTestRunner: 'vitest',
      skipInstall: true,
    });
    const details = getTsLibDetails(tree, {
      name: 'test-lib',
      scope: '@custom',
    });
    expect(details.fullyQualifiedName).toBe('@custom/test-lib');
    expect(tree.exists('test-lib/project.json')).toBeTruthy();
    expect(tree.read('test-lib/project.json', 'utf-8')).toMatchSnapshot(
      'scoped-project.json'
    );
  });
  it('should generate library with subdirectory', async () => {
    await tsLibGenerator(tree, {
      name: 'test-lib',
      subDirectory: 'test-lib',
      directory: 'feature',
      unitTestRunner: 'vitest',
      skipInstall: true,
    });
    // Verify directory structure
    expect(tree.exists('feature/test-lib')).toBeTruthy();
    expect(tree.exists('feature/test-lib/src')).toBeTruthy();
    expect(tree.exists('feature/test-lib/src/index.ts')).toBeTruthy();
    // Create snapshots of generated files
    expect(tree.read('feature/test-lib/src/index.ts', 'utf-8')).toMatchSnapshot(
      'subdir-index.ts'
    );
    expect(
      tree.read('feature/test-lib/tsconfig.json', 'utf-8')
    ).toMatchSnapshot('subdir-tsconfig.json');
    expect(tree.read('feature/test-lib/project.json', 'utf-8')).toMatchSnapshot(
      'subdir-project.json'
    );
  });
});
