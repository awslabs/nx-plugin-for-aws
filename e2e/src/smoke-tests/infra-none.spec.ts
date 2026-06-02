/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, rmSync } from 'fs';
import { ensureDirSync } from 'fs-extra';
import { buildCreateNxWorkspaceCommand, runCLI, tmpProjPath } from '../utils';

describe('smoke test - infra-none', () => {
  const pkgMgr = 'pnpm';
  const targetDir = `${tmpProjPath()}/infra-none-${pkgMgr}`;

  beforeEach(() => {
    console.log(`Cleaning target directory ${targetDir}`);
    if (existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
    ensureDirSync(targetDir);
  });

  it('should generate and build all generators with --infra=none, then upgrade to infra', async () => {
    await runCLI(
      `${buildCreateNxWorkspaceCommand(pkgMgr, 'e2e-test', 'cdk')} --interactive=false --skipGit`,
      {
        cwd: targetDir,
        prefixWithPackageManagerCmd: false,
        redirectStderr: true,
      },
    );
    const projectRoot = `${targetDir}/e2e-test`;
    const opts = { cwd: projectRoot, env: { NX_DAEMON: 'false' } };

    // --- Phase 1: Generate all with infra=none ---

    // Website with infra=none
    await runCLI(
      `generate @aws/nx-plugin:ts#website --name=website --infra=none --no-interactive`,
      opts,
    );

    // tRPC API with infra=none
    await runCLI(
      `generate @aws/nx-plugin:ts#api --name=my-api --infra=none --no-interactive`,
      opts,
    );

    // Python FastAPI with infra=none
    await runCLI(
      `generate @aws/nx-plugin:py#api --name=py-api --infra=none --no-interactive`,
      opts,
    );

    // TypeScript project + lambda function with infra=none
    await runCLI(
      `generate @aws/nx-plugin:ts#project --name=ts-project --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:ts#lambda-function --project=ts-project --name=my-function --event=Any --infra=none --no-interactive`,
      opts,
    );

    // Python project + lambda function with infra=none
    await runCLI(
      `generate @aws/nx-plugin:py#project --name=py-project --projectType=application --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:py#lambda-function --project=e2e_test.py_project --name=my-function --event=Any --infra=none --no-interactive`,
      opts,
    );

    // TypeScript agent with infra=none
    await runCLI(
      `generate @aws/nx-plugin:ts#agent --project=ts-project --name=my-agent --infra=none --no-interactive`,
      opts,
    );

    // TypeScript MCP server with infra=none
    await runCLI(
      `generate @aws/nx-plugin:ts#mcp-server --project=ts-project --name=my-mcp --infra=none --no-interactive`,
      opts,
    );

    // RDB with infra=none
    await runCLI(
      `generate @aws/nx-plugin:ts#rdb --name=my-db --infra=none --engine=postgres --framework=prisma --no-interactive`,
      opts,
    );

    await runCLI(`sync --verbose`, opts);
    await runCLI(
      `run-many --target build --all --output-style=stream --verbose`,
      opts,
    );

    // --- Phase 2: Re-run with infra to add infrastructure ---

    // Re-run website with infra=cloudfront-s3
    await runCLI(
      `generate @aws/nx-plugin:ts#website --name=website --infra=cloudfront-s3 --no-interactive`,
      opts,
    );

    // Re-run tRPC API with infra=rest-lambda
    await runCLI(
      `generate @aws/nx-plugin:ts#api --name=my-api --infra=rest-lambda --no-interactive`,
      opts,
    );

    // Re-run Python FastAPI with infra=rest-lambda
    await runCLI(
      `generate @aws/nx-plugin:py#api --name=py-api --infra=rest-lambda --no-interactive`,
      opts,
    );

    // Re-run lambda function with infra=lambda
    await runCLI(
      `generate @aws/nx-plugin:ts#lambda-function --project=ts-project --name=my-function --event=Any --infra=lambda --no-interactive`,
      opts,
    );

    // Re-run Python lambda function with infra=lambda
    await runCLI(
      `generate @aws/nx-plugin:py#lambda-function --project=e2e_test.py_project --name=my-function --event=Any --infra=lambda --no-interactive`,
      opts,
    );

    // Re-run RDB with infra=aurora
    await runCLI(
      `generate @aws/nx-plugin:ts#rdb --name=my-db --infra=aurora --engine=postgres --framework=prisma --no-interactive`,
      opts,
    );

    await runCLI(`sync --verbose`, opts);
    await runCLI(
      `run-many --target build --all --output-style=stream --verbose`,
      opts,
    );
  });
});
