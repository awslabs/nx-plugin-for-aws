/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { ensureDirSync } from 'fs-extra';
import { buildCreateNxWorkspaceCommand, runCLI, tmpProjPath } from '../utils';
import { join } from 'path';
import { execSync } from 'child_process';
import { describe, beforeEach, it, expect } from 'vitest';

describe('smoke test - git-secrets', () => {
  const pkgMgr = 'pnpm';
  const targetDir = `${tmpProjPath()}/git-secrets-${pkgMgr}`;

  beforeEach(() => {
    if (existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
    ensureDirSync(targetDir);
  });

  it('should generate git-secrets files and husky hook by default', async () => {
    await runCLI(
      `${buildCreateNxWorkspaceCommand(pkgMgr, 'gs-test', 'CDK')} --interactive=false --skipGit`,
      {
        cwd: targetDir,
        prefixWithPackageManagerCmd: false,
        redirectStderr: true,
      },
    );
    const projectRoot = `${targetDir}/gs-test`;

    expect(existsSync(join(projectRoot, '.git-secrets/git-secrets'))).toBe(
      true,
    );
    expect(existsSync(join(projectRoot, '.git-secrets/setup.sh'))).toBe(true);
    expect(existsSync(join(projectRoot, '.husky/pre-commit'))).toBe(true);

    const preCommit = readFileSync(
      join(projectRoot, '.husky/pre-commit'),
      'utf-8',
    );
    expect(preCommit).toContain('git-secrets --pre_commit_hook');

    const packageJson = JSON.parse(
      readFileSync(join(projectRoot, 'package.json'), 'utf-8'),
    );
    expect(packageJson.scripts.prepare).toContain('husky');
    expect(packageJson.scripts.prepare).toContain('.git-secrets/setup.sh');
    expect(packageJson.devDependencies.husky).toBeDefined();
  });

  it('should block commits containing AWS access keys', async () => {
    await runCLI(
      `${buildCreateNxWorkspaceCommand(pkgMgr, 'gs-block', 'CDK')} --interactive=false --skipGit`,
      {
        cwd: targetDir,
        prefixWithPackageManagerCmd: false,
        redirectStderr: true,
      },
    );
    const projectRoot = `${targetDir}/gs-block`;

    execSync('git init', { cwd: projectRoot });
    execSync('git config user.email "test@example.com"', { cwd: projectRoot });
    execSync('git config user.name "Test"', { cwd: projectRoot });

    // Run the prepare script to register AWS patterns and set up husky
    execSync('bash .git-secrets/setup.sh', { cwd: projectRoot });

    // Make the git-secrets script executable
    execSync('chmod +x .git-secrets/git-secrets', { cwd: projectRoot });

    // Write a file containing a fake AWS access key
    const secretFile = join(projectRoot, 'secret.ts');
    writeFileSync(secretFile, `export const KEY = "AKIAIOSFODNN7EXAMPLA";\n`);

    // Stage the file
    execSync('git add secret.ts', { cwd: projectRoot });

    // The pre-commit hook should block this commit
    let commitFailed = false;
    try {
      execSync('bash .git-secrets/git-secrets --pre_commit_hook', {
        cwd: projectRoot,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    } catch (e) {
      commitFailed = true;
      expect(e.stderr).toContain('Matched one or more prohibited patterns');
    }
    expect(commitFailed).toBe(true);
  });

  it('should allow commits that do not contain secrets', async () => {
    await runCLI(
      `${buildCreateNxWorkspaceCommand(pkgMgr, 'gs-allow', 'CDK')} --interactive=false --skipGit`,
      {
        cwd: targetDir,
        prefixWithPackageManagerCmd: false,
        redirectStderr: true,
      },
    );
    const projectRoot = `${targetDir}/gs-allow`;

    execSync('git init', { cwd: projectRoot });
    execSync('git config user.email "test@example.com"', { cwd: projectRoot });
    execSync('git config user.name "Test"', { cwd: projectRoot });

    // Run the prepare script to register AWS patterns and set up husky
    execSync('bash .git-secrets/setup.sh', { cwd: projectRoot });

    // Make the git-secrets script executable
    execSync('chmod +x .git-secrets/git-secrets', { cwd: projectRoot });

    // Write a safe file
    const safeFile = join(projectRoot, 'safe.ts');
    writeFileSync(safeFile, `export const greeting = 'hello world';\n`);

    // Stage the file
    execSync('git add safe.ts', { cwd: projectRoot });

    // The pre-commit hook should allow this commit
    const result = execSync('bash .git-secrets/git-secrets --pre_commit_hook', {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    expect(result).toBeDefined();
  });

  it('should allow the well-known AWS example key', async () => {
    await runCLI(
      `${buildCreateNxWorkspaceCommand(pkgMgr, 'gs-example', 'CDK')} --interactive=false --skipGit`,
      {
        cwd: targetDir,
        prefixWithPackageManagerCmd: false,
        redirectStderr: true,
      },
    );
    const projectRoot = `${targetDir}/gs-example`;

    execSync('git init', { cwd: projectRoot });
    execSync('git config user.email "test@example.com"', { cwd: projectRoot });
    execSync('git config user.name "Test"', { cwd: projectRoot });

    execSync('bash .git-secrets/setup.sh', { cwd: projectRoot });
    execSync('chmod +x .git-secrets/git-secrets', { cwd: projectRoot });

    // Write a file containing the well-known AWS example key (should be allowed)
    const exampleFile = join(projectRoot, 'example.ts');
    writeFileSync(
      exampleFile,
      `export const EXAMPLE_KEY = "AKIAIOSFODNN7EXAMPLE";\n`,
    );

    execSync('git add example.ts', { cwd: projectRoot });

    // Should not throw - example keys are in the allowlist
    execSync('bash .git-secrets/git-secrets --pre_commit_hook', {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
  });
});
