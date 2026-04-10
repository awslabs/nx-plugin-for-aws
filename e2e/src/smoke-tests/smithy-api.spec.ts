/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, rmSync } from 'fs';
import { ensureDirSync } from 'fs-extra';
import { buildCreateNxWorkspaceCommand, runCLI, tmpProjPath } from '../utils';

describe('smoke test - smithy-api', () => {
  const pkgMgr = 'pnpm';
  const targetDir = `${tmpProjPath()}/smithy-${pkgMgr}`;

  beforeEach(() => {
    console.log(`Cleaning target directory ${targetDir}`);
    if (existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
    ensureDirSync(targetDir);
  });

  it('should generate and build', async () => {
    await runCLI(
      `${buildCreateNxWorkspaceCommand(pkgMgr, 'smithy', 'CDK', true)} --interactive=false --skipGit`,
      {
        cwd: targetDir,
        prefixWithPackageManagerCmd: false,
        redirectStderr: true,
      },
    );
    const projectRoot = `${targetDir}/smithy`;
    const opts = { cwd: projectRoot, env: { NX_DAEMON: 'false' } };

    await runCLI(
      `generate @aws/nx-plugin:ts#smithy-api --name=smithy-isolated --integrationPattern=isolated --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:ts#smithy-api --name=smithy-shared --integrationPattern=shared --no-interactive`,
      opts,
    );

    await runCLI(
      `generate @aws/nx-plugin:ts#react-website --name=website --no-interactive`,
      opts,
    );

    await runCLI(
      `generate @aws/nx-plugin:ts#react-website#auth --cognitoDomain=website --project=website --no-interactive --allowSignup=false`,
      opts,
    );

    await runCLI(
      `generate @aws/nx-plugin:connection --sourceProject=website --targetProject=smithy-isolated --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:connection --sourceProject=website --targetProject=smithy-shared --no-interactive`,
      opts,
    );

    await runCLI(`sync --verbose`, opts);
    await runCLI(
      `run-many --target build --all --output-style=stream --verbose`,
      opts,
    );
  });
});
