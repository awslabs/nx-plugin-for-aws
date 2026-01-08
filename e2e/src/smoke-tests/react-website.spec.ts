/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, rmSync } from 'fs';
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
      `${buildCreateNxWorkspaceCommand(pkgMgr, 'react-website', 'CDK', true)} --interactive=false --skipGit`,
      {
        cwd: targetDir,
        prefixWithPackageManagerCmd: false,
        redirectStderr: true,
      },
    );
    const projectRoot = `${targetDir}/react-website`;
    const opts = { cwd: projectRoot, env: { NX_DAEMON: 'false' } };

    await runCLI(
      `generate @aws/nx-plugin:ts#trpc-api --name=my-api --computeType=ServerlessApiGatewayRestApi --no-interactive`,
      opts,
    );

    const permutations = [
      { name: 'website-none', uxProvider: 'None', enableTanstackRouter: true },
      {
        name: 'website-shadcn',
        uxProvider: 'Shadcn',
        enableTanstackRouter: true,
      },
      {
        name: 'website-none-no-router',
        uxProvider: 'None',
        enableTanstackRouter: false,
      },
      {
        name: 'website-shadcn-no-router',
        uxProvider: 'Shadcn',
        enableTanstackRouter: false,
      },
    ] as const;

    for (const { name, uxProvider, enableTanstackRouter } of permutations) {
      const args = [
        `generate @aws/nx-plugin:ts#react-website`,
        `--name=${name}`,
        `--uxProvider=${uxProvider}`,
        `--enableTanstackRouter=${enableTanstackRouter}`,
        `--no-interactive`,
      ];

      await runCLI(args.join(' '), opts);

      await runCLI(
        `generate @aws/nx-plugin:ts#react-website#auth --project=${name} --cognitoDomain=${name} --no-interactive --allowSignup=false`,
        opts,
      );

      await runCLI(
        `generate @aws/nx-plugin:api-connection --sourceProject=${name} --targetProject=my-api --no-interactive`,
        opts,
      );
    }

    await runCLI(`sync --verbose`, opts);
    await runCLI(
      `run-many --target build --all --parallel 1 --output-style=stream --verbose`,
      opts,
    );
  });
});
