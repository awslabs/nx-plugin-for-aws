/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initTestGitRepo, runGit, useIsolatedGitEnv } from './test-git.js';

describe('test-git', () => {
  describe('useIsolatedGitEnv', () => {
    useIsolatedGitEnv();

    it('should point git at a throwaway global config, not the real one', () => {
      const globalConfig = process.env.GIT_CONFIG_GLOBAL;
      expect(globalConfig).toBeDefined();
      expect(globalConfig).toContain('nx-plugin-gitconfig-');

      // A stray `--global` write lands in the throwaway file, so the
      // developer's real ~/.gitconfig is never modified.
      const dir = mkdtempSync(join(tmpdir(), 'test-git-'));
      try {
        initTestGitRepo(dir);
        runGit(
          ['config', '--global', 'user.email', 'stray@example.invalid'],
          dir,
        );
        expect(readFileSync(globalConfig, 'utf-8')).toContain(
          'stray@example.invalid',
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('should clear inherited GIT_DIR so git cannot escape to another repo', () => {
      expect(process.env.GIT_DIR).toBeUndefined();
      expect(process.env.GIT_INDEX_FILE).toBeUndefined();
    });

    it('should keep writes inside the temp repo when GIT_DIR points elsewhere', () => {
      const outer = mkdtempSync(join(tmpdir(), 'test-git-outer-'));
      const inner = mkdtempSync(join(tmpdir(), 'test-git-inner-'));
      try {
        initTestGitRepo(outer);
        initTestGitRepo(inner);

        // Simulate running under a git hook, which exports GIT_DIR pointing at
        // the surrounding repository. `runGit` must ignore it.
        process.env.GIT_DIR = join(outer, '.git');
        process.env.GIT_INDEX_FILE = join(outer, '.git', 'index');

        runGit(['config', 'user.email', 'inner@example.invalid'], inner);

        expect(readFileSync(join(inner, '.git', 'config'), 'utf-8')).toContain(
          'inner@example.invalid',
        );
        expect(
          readFileSync(join(outer, '.git', 'config'), 'utf-8'),
        ).not.toContain('inner@example.invalid');
      } finally {
        rmSync(outer, { recursive: true, force: true });
        rmSync(inner, { recursive: true, force: true });
      }
    });

    it('should give temp repos an identity without any per-repo git config', () => {
      const dir = mkdtempSync(join(tmpdir(), 'test-git-'));
      try {
        initTestGitRepo(dir);
        writeFileSync(join(dir, 'file.txt'), 'contents\n');
        runGit(['add', 'file.txt'], dir);
        // Commits succeed purely from the isolated global config — no
        // `git config user.*` call, so nothing can be written to a real repo.
        runGit(['commit', '-m', 'test'], dir);

        expect(runGit(['log', '--format=%ae'], dir).trim()).toBe(
          'nx-plugin-for-aws-test@example.invalid',
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
