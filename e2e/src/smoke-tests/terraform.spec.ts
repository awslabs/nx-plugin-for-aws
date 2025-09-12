/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { ensureDirSync } from 'fs-extra';
import { buildCreateNxWorkspaceCommand, runCLI, tmpProjPath } from '../utils';
import { join } from 'path';

/**
 * Smoke test for terraform infrastructure
 */
describe('smoke test - terraform', () => {
  const pkgMgr = 'pnpm';
  const targetDir = `${tmpProjPath()}/terraform-${pkgMgr}`;

  beforeEach(() => {
    console.log(`Cleaning target directory ${targetDir}`);
    if (existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
    ensureDirSync(targetDir);
  });

  it(`Should generate and build - ${pkgMgr}`, async () => {
    await runCLI(
      `${buildCreateNxWorkspaceCommand(pkgMgr, 'e2e-test', true)} --interactive=false --skipGit`,
      {
        cwd: targetDir,
        prefixWithPackageManagerCmd: false,
        redirectStderr: true,
      },
    );
    const projectRoot = `${targetDir}/e2e-test`;
    const opts = { cwd: projectRoot, env: { NX_DAEMON: 'false' } };

    await runCLI(
      `generate @aws/nx-plugin:terraform#project --name=infra --type=application --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:ts#react-website --name=website --iacProvider=Terraform --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:ts#trpc-api --name=my-api --computeType=ServerlessApiGatewayRestApi --iacProvider=Terraform --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:ts#react-website#auth --project=@e2e-test/website --iacProvider=Terraform --cognitoDomain=test --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:api-connection --sourceProject=@e2e-test/website --targetProject=@e2e-test/my-api --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:py#fast-api --name=py-api --computeType=ServerlessApiGatewayHttpApi --iacProvider=Terraform --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:py#project --name=py-project --projectType=application --no-interactive`,
      opts,
    );
    // TODO: tf support for py lambda fn
    // await runCLI(
    //   `generate @aws/nx-plugin:py#lambda-function --project=e2e_test.py_project --functionName=my-function --eventSource=Any --no-interactive`,
    //   opts,
    // );
    await runCLI(
      `generate @aws/nx-plugin:py#mcp-server --project=py_project --name=my-mcp-server --computeType=BedrockAgentCoreRuntime --iacProvider=Terraform --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:py#strands-agent --project=py_project --name=my-agent --computeType=BedrockAgentCoreRuntime --iacProvider=Terraform --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:ts#project --name=ts-project --no-interactive`,
      opts,
    );
    // TODO: tf support for ts lambda fn
    // await runCLI(
    //   `generate @aws/nx-plugin:ts#lambda-function --project=ts-project --functionName=my-function --eventSource=Any --no-interactive`,
    //   opts,
    // );
    await runCLI(
      `generate @aws/nx-plugin:ts#mcp-server --project=ts-project --name=my-mcp-server --computeType=BedrockAgentCoreRuntime --iacProvider=Terraform --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:api-connection --sourceProject=website --targetProject=py_api --no-interactive`,
      opts,
    );

    await runCLI(`generate @aws/nx-plugin:license --no-interactive`, opts);

    // Since the smoke tests don't run in a git repo, we need to exclude some patterns for the license sync
    writeFileSync(
      `${opts.cwd}/aws-nx-plugin.config.mts`,
      readFileSync(
        join(__dirname, '../files/aws-nx-plugin.config.mts.template'),
      ),
    );

    await runCLI(`sync --verbose`, opts);
    await runCLI(
      `run-many --target build --all --parallel 1 --output-style=stream --skip-nx-cache --verbose`,
      opts,
    );
  });
});
