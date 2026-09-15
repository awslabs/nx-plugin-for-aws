/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureDirSync } from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCreateNxWorkspaceCommand, runCLI, tmpProjPath } from '../utils';

describe('smoke test - git-secrets', () => {
  const pkgMgr = 'pnpm';
  const targetDir = `${tmpProjPath()}/git-secrets-${pkgMgr}`;
  let gitConfigDir: string;

  /**
   * `git` with an identity supplied through a throwaway config, rather than
   * `git config --global`, which would overwrite the real `user.name`/
   * `user.email` of whoever (or whatever CI runner) ran the suite and leave it
   * overwritten afterwards. `GIT_CONFIG_SYSTEM` points at an empty file so
   * system config cannot supply a conflicting identity.
   */
  const git = (args: string[], cwd: string) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: join(gitConfigDir, 'global'),
        GIT_CONFIG_SYSTEM: join(gitConfigDir, 'system'),
      },
    });

  beforeEach(() => {
    if (existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
    ensureDirSync(targetDir);

    gitConfigDir = mkdtempSync(join(tmpdir(), 'nx-e2e-gitconfig-'));
    writeFileSync(
      join(gitConfigDir, 'global'),
      '[user]\n\tname = E2E Test\n\temail = e2e-test@example.invalid\n',
    );
    writeFileSync(join(gitConfigDir, 'system'), '');
  });

  afterEach(() => {
    if (gitConfigDir && existsSync(gitConfigDir)) {
      rmSync(gitConfigDir, { force: true, recursive: true });
    }
  });

  it('should block commits containing AWS access keys', async () => {
    await runCLI(
      `${buildCreateNxWorkspaceCommand(pkgMgr, 'gs-test', 'cdk')} --interactive=false`,
      {
        cwd: targetDir,
        prefixWithPackageManagerCmd: false,
        redirectStderr: true,
        env: {
          GIT_CONFIG_GLOBAL: join(gitConfigDir, 'global'),
          GIT_CONFIG_SYSTEM: join(gitConfigDir, 'system'),
        },
      },
    );
    const projectRoot = `${targetDir}/gs-test`;

    // Verify workspace was created with git initialized
    expect(existsSync(join(projectRoot, '.git'))).toBe(true);
    expect(existsSync(join(projectRoot, '.git-secrets/git-secrets'))).toBe(
      true,
    );
    expect(existsSync(join(projectRoot, '.husky/pre-commit'))).toBe(true);

    // git commit should fail — the pre-commit hook blocks the secret
    writeFileSync(
      join(projectRoot, 'secret.ts'),
      `export const KEY = "AKIAIOSFODNN7EXAMPLA";\n`,
    );
    git(['add', 'secret.ts'], projectRoot);

    let blocked = false;
    try {
      git(['commit', '-m', 'add secret'], projectRoot);
    } catch (e) {
      blocked = true;
      expect(e.stderr).toContain('Matched one or more prohibited patterns');
    }
    expect(blocked).toBe(true);

    // Safe files can be committed
    git(['rm', '--cached', 'secret.ts'], projectRoot);
    writeFileSync(
      join(projectRoot, 'safe.ts'),
      `export const greeting = 'hello';\n`,
    );
    git(['add', 'safe.ts'], projectRoot);
    git(['commit', '-m', 'add safe file'], projectRoot);

    // The suppression commands the workspace guide documents must genuinely add
    // a pattern. The vendored script parses only the short forms, so those are
    // what the guide gives and what this asserts.
    const gitSecrets = (args: string[]) =>
      execFileSync('bash', ['.git-secrets/git-secrets', ...args], {
        cwd: projectRoot,
        encoding: 'utf-8',
        stdio: 'pipe',
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: join(gitConfigDir, 'global'),
          GIT_CONFIG_SYSTEM: join(gitConfigDir, 'system'),
        },
      });

    gitSecrets(['--add', '-a', '--', 'my-regex-pattern']);
    gitSecrets(['--add', '-a', '-l', '--', 'my-literal+string']);

    const allowed = git(
      ['config', '--get-all', 'secrets.allowed'],
      projectRoot,
    );
    expect(allowed).toContain('my-regex-pattern');
    // -l escapes the regex metacharacters.
    expect(allowed).toContain('my-literal\\+string');

    // A real secret is still caught after suppressing a false positive.
    git(['add', 'secret.ts'], projectRoot);
    let stillBlocked = false;
    try {
      git(['commit', '-m', 'add secret again'], projectRoot);
    } catch (e) {
      stillBlocked = true;
      expect(e.stderr).toContain('Matched one or more prohibited patterns');
    }
    expect(stillBlocked).toBe(true);
    git(['rm', '--cached', 'secret.ts'], projectRoot);

    // The suppressed pattern is genuinely allowed through.
    writeFileSync(
      join(projectRoot, 'allowed.ts'),
      `export const x = 'my-regex-pattern';\n`,
    );
    git(['add', 'allowed.ts'], projectRoot);
    git(['commit', '-m', 'add allowed pattern'], projectRoot);
  });

  it('should commit a generated stages.config.ts once allowed', async () => {
    await runCLI(
      `${buildCreateNxWorkspaceCommand(pkgMgr, 'gs-stages', 'cdk')} --interactive=false`,
      {
        cwd: targetDir,
        prefixWithPackageManagerCmd: false,
        redirectStderr: true,
        env: {
          GIT_CONFIG_GLOBAL: join(gitConfigDir, 'global'),
          GIT_CONFIG_SYSTEM: join(gitConfigDir, 'system'),
        },
      },
    );
    const projectRoot = `${targetDir}/gs-stages`;

    await runCLI(
      `generate @aws/nx-plugin:ts#infra --name=staged-infra --stageConfig=true --no-interactive`,
      { cwd: projectRoot, env: { NX_DAEMON: 'false' } },
    );

    const stagesConfig = join(
      projectRoot,
      'packages/common/infra-config/src/stages.config.ts',
    );
    expect(existsSync(stagesConfig)).toBe(true);

    // Account ids are flagged by default, so committing the stage config is
    // blocked until the user allows them — as the infrastructure guide says.
    git(['add', '-A'], projectRoot);
    let blocked = false;
    try {
      git(['commit', '-m', 'add staged infra'], projectRoot);
    } catch (e) {
      blocked = true;
      expect(e.stderr).toContain('Matched one or more prohibited patterns');
    }
    expect(blocked).toBe(true);

    // The .gitallowed entry the guide documents unblocks it.
    const gitallowed = join(projectRoot, '.gitallowed');
    writeFileSync(
      gitallowed,
      `${readFileSync(gitallowed, 'utf-8')}stages\\.config\\.ts:[0-9]+:.*[0-9]{12}\n`,
    );
    git(['add', '-A'], projectRoot);
    git(['commit', '-m', 'add staged infra'], projectRoot);
  });
});
