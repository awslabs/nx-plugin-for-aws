/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { ensureDirSync } from 'fs-extra';
import { buildCreateNxWorkspaceCommand, runCLI, tmpProjPath } from '../utils';
import { runGeneratorMatrix } from './generator-matrix';

/**
 * idempotency smoke test — runs the full generator matrix, commits the result,
 * then runs the exact same matrix again and asserts there is no git diff.
 *
 * Generators must be idempotent: re-running with the same options must not
 * overwrite user-touched files, duplicate wiring, or otherwise mutate the
 * workspace. A non-empty git status after the second pass means some generator
 * is not idempotent.
 */
describe('smoke test - idempotency', () => {
  const pkgMgr = 'pnpm';
  const targetDir = `${tmpProjPath()}/idempotency-${pkgMgr}`;

  beforeEach(() => {
    console.log(`Cleaning target directory ${targetDir}`);
    if (existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
    ensureDirSync(targetDir);
  });

  it('should produce no git diff when the generator matrix is re-run', async () => {
    await runCLI(
      `${buildCreateNxWorkspaceCommand(pkgMgr, 'e2e-test', 'cdk')} --interactive=false --skipGit`,
      {
        cwd: targetDir,
        prefixWithPackageManagerCmd: false,
        redirectStderr: true,
      },
    );
    const projectRoot = `${targetDir}/e2e-test`;
    const opts = {
      cwd: projectRoot,
      env: {
        NX_DAEMON: 'false',
        NODE_OPTIONS: '--max-old-space-size=8192',
      },
    };

    const git = (command: string): string =>
      execSync(`git ${command}`, {
        cwd: projectRoot,
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
      });

    // CDK-specific infrastructure projects (mirrors runSmokeTest).
    await runCLI(
      `generate @aws/nx-plugin:ts#infra --name=infra --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:ts#infra --name=infra-with-stages --enableStageConfig=true --no-interactive`,
      opts,
    );

    // First pass — scaffold the full matrix.
    await runGeneratorMatrix(opts);

    // Terraform project alongside CDK (mirrors runSmokeTest).
    await runCLI(
      `generate @aws/nx-plugin:terraform#project --name=tf-infra --no-interactive`,
      opts,
    );

    // Commit the generated workspace as the baseline. The workspace was created
    // with --skipGit, so initialise a repo here. The generated .gitignore keeps
    // node_modules / build output out of the snapshot.
    git('init');
    git('add -A');
    git('-c user.name=e2e -c user.email=e2e@example.com commit -m baseline --no-verify');

    // Second pass — re-run the exact same matrix on the committed workspace.
    await runCLI(
      `generate @aws/nx-plugin:ts#infra --name=infra --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:ts#infra --name=infra-with-stages --enableStageConfig=true --no-interactive`,
      opts,
    );
    await runGeneratorMatrix(opts);
    await runCLI(
      `generate @aws/nx-plugin:terraform#project --name=tf-infra --no-interactive`,
      opts,
    );

    // Any change (modified, added or deleted tracked files) means a generator
    // mutated the workspace on re-run and is therefore not idempotent.
    const status = git('status --porcelain').trim();
    if (status) {
      // Surface the offending files and the actual diff in the failure output.
      const diff = git('diff');
      throw new Error(
        `Generators were not idempotent — re-running the matrix changed the workspace:\n\n${status}\n\n${diff}`,
      );
    }
  });
});
