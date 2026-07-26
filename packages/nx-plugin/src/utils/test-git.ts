/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';

/**
 * Identity used by the temp repositories these helpers create. Only ever
 * written to a throwaway `GIT_CONFIG_GLOBAL` file, never to the developer's
 * real config.
 */
const TEST_GIT_USER_NAME = 'nx-plugin-for-aws-test';
const TEST_GIT_USER_EMAIL = 'nx-plugin-for-aws-test@example.invalid';

/**
 * Isolate every git invocation in the surrounding tests from the machine's real
 * git configuration, and point the test identity at a throwaway config file.
 *
 * Two leaks are prevented:
 *
 * 1. Inherited `GIT_*` variables. When the test suite runs from a git hook (the
 *    repo's `pre-commit` runs the unit tests), git exports `GIT_DIR` and
 *    `GIT_INDEX_FILE` pointing at the surrounding repository. Those take
 *    precedence over `cwd`, so `git init`/`git config`/`git commit` in a temp
 *    directory operate on the real repository instead — writing `user.*` into
 *    its `.git/config` and committing test fixtures.
 * 2. Reads of, and writes to, the user's global and system config. Pointing
 *    `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` at files inside a temp directory
 *    means a stray `git config --global` lands there and is deleted with it,
 *    and the developer's real `user.email` can neither leak into assertions nor
 *    be overwritten.
 *
 * Both env vars are restored after each test.
 */
export const useIsolatedGitEnv = () => {
  const savedEnv: Record<string, string | undefined> = {};
  let configDir: string | undefined;

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('GIT_')) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }
    }

    configDir = mkdtempSync(join(tmpdir(), 'nx-plugin-gitconfig-'));
    // Seed the identity here rather than per-repo, so temp repos need no
    // `git config` call at all and cannot write to a real repository.
    writeFileSync(
      join(configDir, 'global'),
      `[user]\n\tname = ${TEST_GIT_USER_NAME}\n\temail = ${TEST_GIT_USER_EMAIL}\n`,
    );
    // Empty, so system config (which may set user.* or hook paths) cannot leak.
    writeFileSync(join(configDir, 'system'), '');

    for (const key of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM'] as const) {
      savedEnv[key] ??= process.env[key];
    }
    process.env.GIT_CONFIG_GLOBAL = join(configDir, 'global');
    process.env.GIT_CONFIG_SYSTEM = join(configDir, 'system');
  });

  afterEach(() => {
    // Clear every GIT_* variable first, so any set *during* the test (and
    // therefore absent from savedEnv) cannot leak into the next one.
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('GIT_')) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value !== undefined) {
        process.env[key] = value;
      }
    }
    for (const key of Object.keys(savedEnv)) {
      delete savedEnv[key];
    }
    if (configDir) {
      rmSync(configDir, { force: true, recursive: true });
      configDir = undefined;
    }
  });
};

/**
 * Run a git command in `cwd`, with the ambient `GIT_DIR`/`GIT_INDEX_FILE`
 * cleared so it cannot escape to a surrounding repository even if
 * `useIsolatedGitEnv` is not in effect. `execFileSync` (no shell) keeps
 * arguments from being re-split.
 */
export const runGit = (args: string[], cwd: string): string =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_DIR: undefined,
      GIT_WORK_TREE: undefined,
      GIT_INDEX_FILE: undefined,
      GIT_COMMON_DIR: undefined,
    } as NodeJS.ProcessEnv,
  });

/**
 * Create a git repository in `dir` for a test to work in. The identity comes
 * from the isolated global config set up by `useIsolatedGitEnv`, so nothing is
 * written outside `dir`. Hooks are disabled — the repo under test has a
 * `pre-commit` hook that runs the whole test suite.
 */
export const initTestGitRepo = (dir: string): void => {
  runGit(['init'], dir);
  runGit(['config', 'core.hooksPath', '/dev/null'], dir);
};
