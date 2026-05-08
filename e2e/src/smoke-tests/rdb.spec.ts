/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, rmSync } from 'fs';
import { ensureDirSync } from 'fs-extra';
import { buildCreateNxWorkspaceCommand, runCLI, tmpProjPath } from '../utils';

describe('smoke test - rdb', () => {
  const pkgMgr = 'pnpm';

  (['CDK', 'Terraform'] as const).forEach((iacProvider) => {
    (['PostgreSQL', 'MySQL'] as const).forEach((engine) => {
      const targetDir = `${tmpProjPath()}/rdb-${iacProvider.toLowerCase()}-${engine.toLowerCase()}-${pkgMgr}`;

      beforeEach(() => {
        console.log(`Cleaning target directory ${targetDir}`);
        if (existsSync(targetDir)) {
          rmSync(targetDir, { force: true, recursive: true });
        }
        ensureDirSync(targetDir);
      });

      it(`should generate and build with iacProvider=${iacProvider} engine=${engine}`, async () => {
        await runCLI(
          `${buildCreateNxWorkspaceCommand(pkgMgr, 'e2e-test', iacProvider)} --interactive=false --skipGit`,
          {
            cwd: targetDir,
            prefixWithPackageManagerCmd: false,
            redirectStderr: true,
          },
        );
        const projectRoot = `${targetDir}/e2e-test`;
        const opts = { cwd: projectRoot, env: { NX_DAEMON: 'false' } };

        await runCLI(
          `generate @aws/nx-plugin:ts#rdb --name=${engine}Db --service=Aurora --engine=${engine} --ormFramework=Prisma --iacProvider=${iacProvider} --no-interactive`,
          opts,
        );

        await runCLI(`sync --verbose`, opts);
        await runCLI(
          `run-many --target build --all --output-style=stream --verbose`,
          opts,
        );
      });
    });
  });
});
