/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, rmSync } from 'node:fs';
import { ensureDirSync } from 'fs-extra';
import { buildCreateNxWorkspaceCommand, runCLI, tmpProjPath } from '../utils';

describe('smoke test - react-website', () => {
  const pkgMgr = 'pnpm';
  const targetDir = `${tmpProjPath()}/react-website-${pkgMgr}`;

  beforeEach(() => {
    console.log(`Cleaning target directory ${targetDir}`);
    if (existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
    ensureDirSync(targetDir);
  });

  it('should generate and build', async () => {
    await runCLI(
      `${buildCreateNxWorkspaceCommand(pkgMgr, 'react-website', 'cdk')} --interactive=false --skipGit`,
      {
        cwd: targetDir,
        prefixWithPackageManagerCmd: false,
        redirectStderr: true,
      },
    );
    const projectRoot = `${targetDir}/react-website`;
    const opts = { cwd: projectRoot, env: { NX_DAEMON: 'false' } };

    await runCLI(
      `generate @aws/nx-plugin:ts#api --name=my-api --infra=rest-lambda --no-interactive`,
      opts,
    );

    const permutations = [
      { name: 'website-none', ux: 'none', tanstackRouter: true },
      {
        name: 'website-shadcn',
        ux: 'shadcn',
        tanstackRouter: true,
      },
      {
        name: 'website-none-no-router',
        ux: 'none',
        tanstackRouter: false,
      },
      {
        name: 'website-shadcn-no-router',
        ux: 'shadcn',
        tanstackRouter: false,
      },
    ] as const;

    for (const { name, ux, tanstackRouter } of permutations) {
      const args = [
        `generate @aws/nx-plugin:ts#website`,
        `--name=${name}`,
        `--ux=${ux}`,
        `--tanstackRouter=${tanstackRouter}`,
        `--no-interactive`,
      ];

      await runCLI(args.join(' '), opts);

      await runCLI(
        `generate @aws/nx-plugin:ts#website#auth --project=${name} --cognitoDomain=${name} --no-interactive --allowSignup=false`,
        opts,
      );

      await runCLI(
        `generate @aws/nx-plugin:connection --sourceProject=${name} --targetProject=my-api --no-interactive`,
        opts,
      );
    }

    await runCLI(`sync --verbose`, opts);
    await runCLI(
      `run-many --target build --all --output-style=stream --verbose`,
      opts,
    );
  });
});
