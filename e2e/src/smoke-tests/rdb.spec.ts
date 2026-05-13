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

        // RDB project name follows kebab-case: PostgreSQLDb → postgre-sql-db, MySQLDb → my-sql-db
        const rdbProjectName =
          engine === 'PostgreSQL' ? 'postgre-sql-db' : 'my-sql-db';
        const rdbProject = `@e2e-test/${rdbProjectName}`;

        await runCLI(
          `generate @aws/nx-plugin:ts#rdb --name=${engine}Db --service=Aurora --engine=${engine} --ormFramework=Prisma --iacProvider=${iacProvider} --no-interactive`,
          opts,
        );

        // Source projects for connection testing
        await runCLI(
          `generate @aws/nx-plugin:ts#trpc-api --name=my-api --computeType=ServerlessApiGatewayRestApi --no-interactive`,
          opts,
        );
        await runCLI(
          `generate @aws/nx-plugin:ts#smithy-api --name=my-smithy-api --no-interactive`,
          opts,
        );
        await runCLI(
          `generate @aws/nx-plugin:ts#project --name=agents --no-interactive`,
          opts,
        );
        await runCLI(
          `generate @aws/nx-plugin:ts#strands-agent --project=agents --name=http-agent --computeType=None --no-interactive`,
          opts,
        );
        await runCLI(
          `generate @aws/nx-plugin:ts#strands-agent --project=agents --name=a2a-agent --protocol=A2A --computeType=None --no-interactive`,
          opts,
        );
        await runCLI(
          `generate @aws/nx-plugin:ts#mcp-server --project=agents --name=my-mcp --computeType=None --no-interactive`,
          opts,
        );

        // RDB connections
        await runCLI(
          `generate @aws/nx-plugin:connection --sourceProject=@e2e-test/my-api --targetProject=${rdbProject} --no-interactive`,
          opts,
        );
        await runCLI(
          `generate @aws/nx-plugin:connection --sourceProject=@e2e-test/my-smithy-api --targetProject=${rdbProject} --no-interactive`,
          opts,
        );
        await runCLI(
          `generate @aws/nx-plugin:connection --sourceProject=agents --sourceComponent=http-agent --targetProject=${rdbProject} --no-interactive`,
          opts,
        );
        await runCLI(
          `generate @aws/nx-plugin:connection --sourceProject=agents --sourceComponent=a2a-agent --targetProject=${rdbProject} --no-interactive`,
          opts,
        );
        await runCLI(
          `generate @aws/nx-plugin:connection --sourceProject=agents --sourceComponent=my-mcp --targetProject=${rdbProject} --no-interactive`,
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
