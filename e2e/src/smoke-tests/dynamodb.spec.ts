/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, rmSync } from 'fs';
import { ensureDirSync } from 'fs-extra';
import { buildCreateNxWorkspaceCommand, runCLI, tmpProjPath } from '../utils';
import { setFinchAsContainerEngine } from './finch-install';

describe('smoke test - dynamodb', () => {
  const pkgMgr = 'pnpm';

  (['CDK', 'Terraform'] as const).forEach((iacProvider) => {
    (['docker', 'finch'] as const).forEach((containerEngine) => {
      const targetDir = `${tmpProjPath()}/dynamodb-${iacProvider.toLowerCase()}-${containerEngine}-${pkgMgr}`;

      beforeEach(() => {
        console.log(`Cleaning target directory ${targetDir}`);
        if (existsSync(targetDir)) {
          rmSync(targetDir, { force: true, recursive: true });
        }
        ensureDirSync(targetDir);
      });

      it(`should generate and build with iacProvider=${iacProvider} containerEngine=${containerEngine}`, async () => {
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

        if (containerEngine === 'finch') {
          setFinchAsContainerEngine(projectRoot);
        }

        await runCLI(
          `generate @aws/nx-plugin:ts#dynamodb --name=my-table --iacProvider=${iacProvider} --no-interactive`,
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
          `generate @aws/nx-plugin:ts#agent --project=agents --name=my-agent --computeType=None --no-interactive`,
          opts,
        );
        await runCLI(
          `generate @aws/nx-plugin:ts#mcp-server --project=agents --name=my-mcp --computeType=None --no-interactive`,
          opts,
        );

        // DynamoDB connections
        await runCLI(
          `generate @aws/nx-plugin:connection --sourceProject=my-api --targetProject=@e2e-test/my-table --no-interactive`,
          opts,
        );
        await runCLI(
          `generate @aws/nx-plugin:connection --sourceProject=my-smithy-api --targetProject=@e2e-test/my-table --no-interactive`,
          opts,
        );
        await runCLI(
          `generate @aws/nx-plugin:connection --sourceProject=agents --sourceComponent=my-agent --targetProject=@e2e-test/my-table --no-interactive`,
          opts,
        );
        await runCLI(
          `generate @aws/nx-plugin:connection --sourceProject=agents --sourceComponent=my-mcp --targetProject=@e2e-test/my-table --no-interactive`,
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
