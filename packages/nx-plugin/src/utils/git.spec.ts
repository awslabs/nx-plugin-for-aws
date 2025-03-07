/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { flushChanges, FsTree, Tree } from 'nx/src/generators/tree';
import { getGitIncludedFiles, updateGitIgnore } from './git';
import { mkdtempSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { createTreeUsingTsSolutionSetup } from './test';

describe('git utils', () => {
  describe('getGitIncludedFiles', () => {
    let tmpDir: string;
    let tree: FsTree;

    beforeEach(() => {
      tmpDir = mkdtempSync(path.join(os.tmpdir(), 'test-dir'));
      tree = new FsTree(tmpDir, false);
      execSync('git init', { cwd: tmpDir });
      execSync('git config user.email test@example.com', { cwd: tmpDir });
      execSync('git config user.name test', { cwd: tmpDir });
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should get all git included files', () => {
      tree.write('.gitignore', `*.txt`);
      tree.write('committed.ts', "const foo = 'bar';");
      tree.write('committed-but-will-be-deleted.ts', 'const x = 1;');

      flushChanges(tree.root, tree.listChanges());

      execSync('git add .', { cwd: tmpDir });
      execSync("git commit -m 'test' --no-verify", { cwd: tmpDir });

      tree.write('new-and-not-committed.ts', "const bar = 'baz';");
      tree.write('ignored.txt', 'should not be included');
      tree.delete('committed-but-will-be-deleted.ts');

      flushChanges(tree.root, tree.listChanges());

      const includedFiles = getGitIncludedFiles(tree);

      expect(includedFiles).toContain('committed.ts');
      expect(includedFiles).toContain('new-and-not-committed.ts');
      expect(includedFiles).not.toContain('ignored.txt');
      expect(includedFiles).not.toContain('committed-but-will-be-deleted.ts');
    });
  });

  describe('updateGitIgnore', () => {
    let tree: Tree;

    beforeEach(() => {
      tree = createTreeUsingTsSolutionSetup();
    });

    it('should create new .gitignore file if it does not exist', () => {
      updateGitIgnore(tree, '.', (patterns) => {
        expect(patterns).toEqual([]);
        return ['*.log', 'node_modules/'];
      });

      const content = tree.read('.gitignore', 'utf-8');
      expect(content).toBe('*.log\nnode_modules/');
    });

    it('should update existing .gitignore file', () => {
      tree.write('.gitignore', '*.log\nnode_modules/');

      updateGitIgnore(tree, '.', (patterns) => {
        expect(patterns).toEqual(['*.log', 'node_modules/']);
        return [...patterns, 'dist/'];
      });

      const content = tree.read('.gitignore', 'utf-8');
      expect(content).toBe('*.log\nnode_modules/\ndist/');
    });

    it('should ensure patterns are unique', () => {
      tree.write('.gitignore', '*.log\nnode_modules/');

      updateGitIgnore(tree, '.', (patterns) => {
        return [...patterns, '*.log', 'dist/', 'dist/'];
      });

      const content = tree.read('.gitignore', 'utf-8');
      expect(content).toBe('*.log\nnode_modules/\ndist/');
    });

    it('should support nested directory paths', () => {
      updateGitIgnore(tree, 'nested/dir', (patterns) => {
        expect(patterns).toEqual([]);
        return ['*.log'];
      });

      const content = tree.read('nested/dir/.gitignore', 'utf-8');
      expect(content).toBe('*.log');
    });
  });
});
