/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getPackageManagerCommand, PackageManager } from '@nx/devkit';
import { buildCreateNxWorkspaceCommand, runCLI, tmpProjPath } from '../utils';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { ensureDirSync } from 'fs-extra';
import { join } from 'path';
import { beforeEach, describe, it } from 'vitest';

export const smokeTest = (
  pkgMgr: PackageManager,
  onProjectCreate?: (projectRoot: string) => void,
) => {
  describe(`smoke test - ${pkgMgr}`, () => {
    beforeEach(() => {
      const targetDir = `${tmpProjPath()}/${pkgMgr}`;
      console.log(`Cleaning target directory ${targetDir}`);
      if (existsSync(targetDir)) {
        rmSync(targetDir, { force: true, recursive: true });
      }
      ensureDirSync(targetDir);
    });

    it(`Should generate and build - ${pkgMgr}`, async () => {
      await runCLI(
        `${buildCreateNxWorkspaceCommand(pkgMgr, 'e2e-test')} --interactive=false --skipGit`,
        {
          cwd: `${tmpProjPath()}/${pkgMgr}`,
          prefixWithPackageManagerCmd: false,
          redirectStderr: true,
        },
      );
      const projectRoot = `${tmpProjPath()}/${pkgMgr}/e2e-test`;
      const opts = { cwd: projectRoot, env: { NX_DAEMON: 'false' } };
      if (onProjectCreate) {
        onProjectCreate(projectRoot);
      }
      await runCLI(
        `generate @aws/nx-plugin:ts#infra --name=infra --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:ts#cloudscape-website --name=website --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:ts#trpc-api --apiName=my-api --computeType=ServerlessApiGatewayRestApi --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:ts#trpc-api --apiName=my-api-http --computeType=ServerlessApiGatewayHttpApi --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:ts#cloudscape-website#auth --project=@e2e-test/website --cognitoDomain=test --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:api-connection --sourceProject=@e2e-test/website --targetProject=@e2e-test/my-api-backend --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:py#fast-api --name=py-api --computeType=ServerlessApiGatewayRestApi --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:py#fast-api --name=py-api-http --computeType=ServerlessApiGatewayHttpApi --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:py#project --name=py-project --projectType=application --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:py#lambda-function --project=e_2_e_test.py_project --functionName=my-function --eventSource=Any --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:api-connection --sourceProject=@e2e-test/website --targetProject=e_2_e_test.py_api --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:ts#mcp-server --name=my-mcp-server --no-interactive`,
        opts,
      );
      await runCLI(`generate @aws/nx-plugin:license --no-interactive`, opts);

      await runCLI(
        `generate @aws/nx-plugin:ts#project --name=plugin --directory=tools --no-interactive`,
        opts,
      );

      await runCLI(
        `generate @aws/nx-plugin:ts#nx-generator --pluginProject=@e2e-test/plugin --name=my#generator --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @e2e-test/plugin:my#generator --exampleOption=test --no-interactive`,
        opts,
      );

      // Wire up website, cognito and trpc api
      writeFileSync(
        `${opts.cwd}/packages/infra/src/stacks/application-stack.ts`,
        readFileSync(join(__dirname, '../files/application-stack.ts.template')),
      );
      await runCLI(`sync --verbose`, opts);
      await runCLI(
        `run-many --target build --all --parallel 1 --output-style=stream --skip-nx-cache --verbose`,
        opts,
      );
    });
  });
};
