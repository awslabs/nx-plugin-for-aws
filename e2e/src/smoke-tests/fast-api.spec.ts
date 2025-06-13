/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, rmSync } from 'fs';
import { ensureDirSync } from 'fs-extra';
import { buildCreateNxWorkspaceCommand, runCLI, tmpProjPath } from '../utils';
import {
  connectApiProjectPermutations,
  generateApiProjectPermutations,
} from '../utils/api';

describe('smoke test - fast-api', () => {
  const pkgMgr = 'pnpm';
  const targetDir = `${tmpProjPath()}/fast-api-${pkgMgr}`;

  beforeEach(() => {
    console.log(`Cleaning target directory ${targetDir}`);
    if (existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
    ensureDirSync(targetDir);
  });

  it('should generate and build', async () => {
    await runCLI(
      `${buildCreateNxWorkspaceCommand(pkgMgr, 'fast-api', true)} --interactive=false --skipGit`,
      {
        cwd: targetDir,
        prefixWithPackageManagerCmd: false,
        redirectStderr: true,
      },
    );
    const projectRoot = `${targetDir}/fast-api`;
    const opts = { cwd: projectRoot, env: { NX_DAEMON: 'false' } };

    await generateApiProjectPermutations('py#fast-api', 'fast', '_', opts);

    await runCLI(
      `generate @aws/nx-plugin:ts#cloudscape-website --name=website --no-interactive`,
      opts,
    );

    await runCLI(
      `generate @aws/nx-plugin:ts#cloudscape-website#auth --cognitoDomain=website --project=website --no-interactive --allowSignup=false`,
      opts,
    );

    await connectApiProjectPermutations('website', 'fast', '_', opts);

    await runCLI(`sync --verbose`, opts);
    await runCLI(
      `run-many --target build --all --parallel 1 --output-style=stream --verbose`,
      opts,
    );
  });
});
