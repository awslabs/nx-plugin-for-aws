/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { ensureDirSync } from 'fs-extra';
import { buildCreateNxWorkspaceCommand, runCLI, tmpProjPath } from '../utils';
import { join } from 'path';
import { execSync } from 'child_process';

describe('smoke test - license-sync', () => {
  const pkgMgr = 'pnpm';
  const targetDir = `${tmpProjPath()}/license-sync-${pkgMgr}`;

  beforeEach(() => {
    console.log(`Cleaning target directory ${targetDir}`);
    if (existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
    ensureDirSync(targetDir);
  });

  it('should apply license headers to ts and py source files via sync', async () => {
    await runCLI(
      `${buildCreateNxWorkspaceCommand(pkgMgr, 'license-test', 'CDK', true)} --interactive=false --skipGit`,
      {
        cwd: targetDir,
        prefixWithPackageManagerCmd: false,
        redirectStderr: true,
      },
    );
    const projectRoot = `${targetDir}/license-test`;
    const opts = {
      cwd: projectRoot,
      env: {
        NX_DAEMON: 'false',
      },
    };

    // Initialize a git repo so the license sync generator can use git to find candidate files
    execSync('git init', { cwd: projectRoot });

    // Generate a TypeScript project (before license generator)
    await runCLI(
      `generate @aws/nx-plugin:ts#project --name=ts-lib --no-interactive`,
      opts,
    );

    // Write a sample TypeScript source file (without a license header)
    const tsSamplePath = join(projectRoot, 'packages/ts-lib/src/sample.ts');
    writeFileSync(tsSamplePath, `export const greeting = 'hello world';\n`);

    // Run the license generator
    await runCLI(`generate @aws/nx-plugin:license --no-interactive`, opts);

    // Generate a Python project (after license generator)
    await runCLI(
      `generate @aws/nx-plugin:py#project --name=py-lib --projectType=application --no-interactive`,
      opts,
    );

    // Write a sample Python source file (without a license header)
    const pySamplePath = join(
      projectRoot,
      'packages/py_lib/license_test_py_lib/sample.py',
    );
    writeFileSync(pySamplePath, `greeting = "hello world"\n`);

    // Step 5: Run sync
    await runCLI(`sync --verbose`, opts);

    // Step 6: Verify license headers were applied
    const tsContent = readFileSync(tsSamplePath, 'utf-8');
    expect(tsContent).toContain('Copyright Amazon.com, Inc. or its affiliates');
    expect(tsContent).toContain('SPDX-License-Identifier: Apache-2.0');
    // Ensure the original content is still present
    expect(tsContent).toContain("export const greeting = 'hello world';");

    const pyContent = readFileSync(pySamplePath, 'utf-8');
    expect(pyContent).toContain('Copyright Amazon.com, Inc. or its affiliates');
    expect(pyContent).toContain('SPDX-License-Identifier: Apache-2.0');
    // Ensure the original content is still present
    expect(pyContent).toContain('greeting = "hello world"');
  });
});
