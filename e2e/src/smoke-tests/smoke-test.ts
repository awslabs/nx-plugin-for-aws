/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { runCLI, tmpProjPath } from '../utils';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { ensureDirSync } from 'fs-extra';
import { join } from 'path';
import { beforeEach, describe, it } from 'vitest';

export const smokeTest = (pkgMgr: string) => {
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
        `npx -y create-nx-workspace e2e-test --ci=skip --skipGit --preset=ts --interactive=false --pm ${pkgMgr}`,
        {
          cwd: `${tmpProjPath()}/${pkgMgr}`,
          prefixWithPackageManagerCmd: false,
          redirectStderr: true,
        }
      );

      const opts = { cwd: `${tmpProjPath()}/${pkgMgr}/e2e-test` };
      await runCLI(`add @aws/nx-plugin`, { ...opts, retry: true }); // This can sometimes fail intermittently so add retries
      await runCLI(
        `generate @aws/nx-plugin:infra#app --name=infra --no-interactive`,
        opts
      );
      await runCLI(
        `generate @aws/nx-plugin:cloudscape-website#app --name=website --no-interactive`,
        opts
      );
      await runCLI(
        `generate @aws/nx-plugin:trpc#backend --apiName=my-api --apiNamespace=@e2e-test --no-interactive`,
        opts
      );
      await runCLI(
        `generate @aws/nx-plugin:cloudscape-website#cognito-auth --project=@e2e-test/website --no-interactive`,
        opts
      );
      await runCLI(
        `generate @aws/nx-plugin:trpc#react --frontendProjectName=@e2e-test/website --backendProjectName=@e2e-test/my-api-backend --no-interactive`,
        opts
      );

      // Wire up website, cognito and trpc api
      writeFileSync(
        `${opts.cwd}/packages/infra/src/stacks/application-stack.ts`,
        readFileSync(join(__dirname, '../files/application-stack.ts.template'))
      );

      await runCLI(`sync`, opts);
      await runCLI(
        `run-many --target build --all --parallel 12 --output-style=stream`,
        opts
      );
    });
  });
};
