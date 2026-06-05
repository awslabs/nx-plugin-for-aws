/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDirSync } from 'fs-extra';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildCreateNxWorkspaceCommand, runCLI, tmpProjPath } from '../utils';

describe('smoke test - git-secrets', () => {
  const pkgMgr = 'pnpm';
  const targetDir = `${tmpProjPath()}/git-secrets-${pkgMgr}`;

  beforeEach(() => {
    if (existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
    ensureDirSync(targetDir);
    execSync('git config --global user.email "test@example.com"', {
      stdio: 'pipe',
    });
    execSync('git config --global user.name "Test"', { stdio: 'pipe' });
  });

  it('should block commits containing AWS access keys', async () => {
    await runCLI(
      `${buildCreateNxWorkspaceCommand(pkgMgr, 'gs-test', 'cdk')} --interactive=false`,
      {
        cwd: targetDir,
        prefixWithPackageManagerCmd: false,
        redirectStderr: true,
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
    execSync('git add secret.ts', { cwd: projectRoot });

    let blocked = false;
    try {
      execSync('git commit -m "add secret"', {
        cwd: projectRoot,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    } catch (e) {
      blocked = true;
      expect(e.stderr).toContain('Matched one or more prohibited patterns');
    }
    expect(blocked).toBe(true);

    // Safe files can be committed
    execSync('git rm --cached secret.ts', {
      cwd: projectRoot,
      stdio: 'pipe',
    });
    writeFileSync(
      join(projectRoot, 'safe.ts'),
      `export const greeting = 'hello';\n`,
    );
    execSync('git add safe.ts', { cwd: projectRoot });
    execSync('git commit -m "add safe file"', {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
  });
});
