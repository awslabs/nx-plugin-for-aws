/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createTreeWithEmptyWorkspace } from 'nx/src/devkit-testing-exports';
import { join } from 'path';
import { updateGitIgnore } from './gitignore';

describe('updateGitIgnore', () => {
  const testDir = 'test-dir';
  const gitignorePath = join(testDir, '.gitignore');

  it('should create gitignore file if it does not exist', () => {
    const tree = createTreeWithEmptyWorkspace();

    updateGitIgnore(tree, testDir, (patterns) => {
      expect(patterns).toEqual([]);
      return ['node_modules/', 'dist/'];
    });

    const content = tree.read(gitignorePath, 'utf-8');
    expect(content).toBe('node_modules/\ndist/');
  });

  it('should update existing gitignore file', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write(gitignorePath, 'node_modules/\ndist/');

    updateGitIgnore(tree, testDir, (patterns) => {
      expect(patterns).toEqual(['node_modules/', 'dist/']);
      return [...patterns, 'coverage/'];
    });

    const content = tree.read(gitignorePath, 'utf-8');
    expect(content).toBe('node_modules/\ndist/\ncoverage/');
  });

  it('should update gitignore multiple times', () => {
    const tree = createTreeWithEmptyWorkspace();

    updateGitIgnore(tree, testDir, (patterns) => {
      expect(patterns).toEqual([]);
      return ['node_modules/', 'dist/'];
    });

    updateGitIgnore(tree, testDir, (patterns) => {
      return [...patterns, 'coverage/'];
    });

    const content = tree.read(gitignorePath, 'utf-8');
    expect(content).toBe('node_modules/\ndist/\ncoverage/');
  });

  it('should remove duplicate patterns', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write(gitignorePath, 'node_modules/\ndist/');

    updateGitIgnore(tree, testDir, (patterns) => {
      return [...patterns, 'dist/', 'coverage/', 'coverage/'];
    });

    const content = tree.read(gitignorePath, 'utf-8');
    expect(content).toBe('node_modules/\ndist/\ncoverage/');
  });
});
