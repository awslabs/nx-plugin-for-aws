/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { flushChanges, FsTree } from 'nx/src/generators/tree';
import { getGitIncludedFiles } from './git';
import { mkdtempSync, rmSync } from 'fs';
import { execSync } from 'child_process';

describe('git utils', () => {
  describe('getGitIncludedFiles', () => {
    let tmpDir: string;
    let tree: FsTree;

    beforeEach(() => {
      tmpDir = mkdtempSync('test-dir');
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

      flushChanges(tree.root, tree.listChanges());

      execSync('git add .', { cwd: tmpDir });
      execSync("git commit -m 'test' --no-verify", { cwd: tmpDir });

      tree.write('new-and-not-committed.ts', "const bar = 'baz';");
      tree.write('ignored.txt', 'should not be included');

      flushChanges(tree.root, tree.listChanges());

      const includedFiles = getGitIncludedFiles(tree);

      expect(includedFiles).toContain('committed.ts');
      expect(includedFiles).toContain('new-and-not-committed.ts');
      expect(includedFiles).not.toContain('ignored.txt');
    });
  });
});
