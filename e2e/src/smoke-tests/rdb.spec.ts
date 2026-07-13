/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, rmSync } from 'node:fs';
import { ensureDirSync } from 'fs-extra';
import { createTestWorkspace, runCLI, tmpProjPath } from '../utils';

describe('smoke test - rdb', () => {
  const pkgMgr = 'pnpm';

  (['cdk', 'terraform'] as const).forEach((iac) => {
    (['postgres', 'mysql'] as const).forEach((engine) => {
      const targetDir = `${tmpProjPath()}/rdb-${iac}-${engine}-${pkgMgr}`;

      beforeEach(() => {
        console.log(`Cleaning target directory ${targetDir}`);
        if (existsSync(targetDir)) {
          rmSync(targetDir, { force: true, recursive: true });
        }
        ensureDirSync(targetDir);
      });

      it(`should generate and build with iac=${iac} engine=${engine}`, async () => {
        const projectRoot = await createTestWorkspace(
          pkgMgr,
          targetDir,
          'e2e-test',
          iac,
        );
        const opts = { cwd: projectRoot, env: { NX_DAEMON: 'false' } };

        const rdbProjectName =
          engine === 'postgres' ? 'postgres-db' : 'mysql-db';
        const rdbProject = `@e2e-test/${rdbProjectName}`;

        await runCLI(
          `generate @aws/nx-plugin:ts#rdb --name=${engine}-db --infra=aurora --engine=${engine} --framework=prisma --iac=${iac} --no-interactive`,
          opts,
        );
        await runCLI(
          `generate @aws/nx-plugin:py#rdb --name=py-${engine}-db --infra=aurora --engine=${engine} --framework=sqlmodel --iac=${iac} --no-interactive`,
          opts,
        );

        const pyRdbProject = `py_${engine}_db`;

        // TypeScript source projects for connection testing
        await runCLI(
          `generate @aws/nx-plugin:ts#api --name=my-api --infra=rest-lambda --no-interactive`,
          opts,
        );
        await runCLI(
          `generate @aws/nx-plugin:ts#api --name=my-smithy-api --framework=smithy --no-interactive`,
          opts,
        );
        await runCLI(
          `generate @aws/nx-plugin:ts#project --name=agents --no-interactive`,
          opts,
        );
        await runCLI(
          `generate @aws/nx-plugin:ts#agent --project=agents --name=http-agent --infra=none --no-interactive`,
          opts,
        );
        await runCLI(
          `generate @aws/nx-plugin:ts#agent --project=agents --name=a2a-agent --protocol=a2a --infra=none --no-interactive`,
          opts,
        );
        await runCLI(
          `generate @aws/nx-plugin:ts#mcp-server --project=agents --name=my-mcp --infra=none --no-interactive`,
          opts,
        );

        // Python source projects for connection testing
        await runCLI(
          `generate @aws/nx-plugin:py#api --name=py-api --infra=rest-lambda --no-interactive`,
          opts,
        );
        await runCLI(
          `generate @aws/nx-plugin:py#project --name=py-agents --projectType=application --no-interactive`,
          opts,
        );
        await runCLI(
          `generate @aws/nx-plugin:py#agent --project=py_agents --name=py-agent --infra=none --no-interactive`,
          opts,
        );
        await runCLI(
          `generate @aws/nx-plugin:py#mcp-server --project=py_agents --name=py-mcp --infra=none --no-interactive`,
          opts,
        );

        // TypeScript RDB connections
        await runCLI(
          `generate @aws/nx-plugin:connection --sourceProject=my-api --targetProject=${rdbProject} --no-interactive`,
          opts,
        );
        await runCLI(
          `generate @aws/nx-plugin:connection --sourceProject=my-smithy-api --targetProject=${rdbProject} --no-interactive`,
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

        // Python RDB connections
        await runCLI(
          `generate @aws/nx-plugin:connection --sourceProject=py_api --targetProject=${pyRdbProject} --no-interactive`,
          opts,
        );
        await runCLI(
          `generate @aws/nx-plugin:connection --sourceProject=py_agents --sourceComponent=py-agent --targetProject=${pyRdbProject} --no-interactive`,
          opts,
        );
        await runCLI(
          `generate @aws/nx-plugin:connection --sourceProject=py_agents --sourceComponent=py-mcp --targetProject=${pyRdbProject} --no-interactive`,
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
