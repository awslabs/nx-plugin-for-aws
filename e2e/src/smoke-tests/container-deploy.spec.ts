/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CloudFormation } from '@aws-sdk/client-cloudformation';
import { ensureDirSync } from 'fs-extra';
import {
  createTestWorkspace,
  pinAwsScopeToLocalRegistry,
  runCLI,
  runInstall,
  tmpProjPath,
} from '../utils';
import {
  invokeContainerHealth,
  invokeIamApiNoAuthDenied,
} from './deploy-invocations';
import { applyInfra } from './terraform-apply';
import { terraformStateBucketExists } from './terraform-state-bucket';

function readTerraformOutputs(projectRoot: string): Record<string, string> {
  const raw = execSync('terraform output -json', {
    cwd: join(projectRoot, 'packages/infra/src'),
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
  });
  const parsed = JSON.parse(raw) as Record<
    string,
    { value: unknown; type: unknown }
  >;
  return Object.fromEntries(
    Object.entries(parsed).map(([k, v]) => [k, String(v.value)]),
  );
}

/**
 * container-deploy smoke test: deploys one `ts#container` and one
 * `py#container` service (default `http-api` ingress and `iam` auth) into a
 * VPC the test creates, first with CDK and then with Terraform. For each
 * service it calls `GET /health` through the HTTP API with SigV4, checks that
 * an unsigned call is denied, and destroys everything in `finally`.
 *
 * It builds a small workspace of its own rather than the full generator
 * matrix, and runs only on pushes to `main` (`.github/workflows/ci.yml`).
 */
describe('smoke test - container-deploy', () => {
  const pkgMgr = 'pnpm';

  (['cdk', 'terraform'] as const).forEach((iac) => {
    const targetDir = `${tmpProjPath()}/container-deploy-${iac}-${pkgMgr}`;

    beforeEach(() => {
      console.log(`Cleaning target directory ${targetDir}`);
      if (existsSync(targetDir)) {
        rmSync(targetDir, { force: true, recursive: true });
      }
      ensureDirSync(targetDir);
      pinAwsScopeToLocalRegistry(targetDir);
    });

    it(`should deploy and call the container services with iac=${iac}`, async () => {
      const projectRoot = await createTestWorkspace(
        pkgMgr,
        targetDir,
        'e2e-test',
        iac,
      );
      const opts = {
        cwd: projectRoot,
        env: {
          NX_DAEMON: 'false',
          NODE_OPTIONS: '--max-old-space-size=8192',
        },
      };

      if (iac === 'cdk') {
        await runCLI(
          `generate @aws/nx-plugin:ts#infra --name=infra --no-interactive`,
          opts,
        );
      } else {
        await runCLI(
          `generate @aws/nx-plugin:terraform#project --name=infra --type=application --no-interactive`,
          opts,
        );
      }
      await runCLI(
        `generate @aws/nx-plugin:ts#project --name=ts-project --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:ts#container --project=ts-project --name=ts-service --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:py#project --name=py-project --type=application --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:py#container --project=py_project --name=py-service --no-interactive`,
        opts,
      );

      writeFileSync(
        `${projectRoot}/aws-nx-plugin.config.mts`,
        readFileSync(
          join(__dirname, '../files/aws-nx-plugin.config.mts.template'),
          'utf-8',
        ),
      );

      // Swap in the stack that wires both services into a VPC before the
      // build, so the build synthesises and scans it.
      if (iac === 'cdk') {
        writeFileSync(
          `${projectRoot}/packages/infra/src/stacks/application-stack.ts`,
          readFileSync(
            join(
              __dirname,
              '../files/container-deploy/application-stack.ts.template',
            ),
            'utf-8',
          ),
        );
      }

      await runInstall(opts);
      await runCLI(`sync --verbose`, opts);
      // Sync writes local workspace dependencies into project manifests.
      await runInstall(opts);
      await runCLI(
        `run-many --target build --all --output-style=stream --verbose`,
        opts,
      );

      const testRunId = Math.random().toString(36).substring(2, 10);

      if (iac === 'cdk') {
        // Removal policies set to destroy, and stack names unique to this run.
        writeFileSync(
          `${projectRoot}/packages/infra/src/main.ts`,
          readFileSync(
            join(__dirname, '../files/cdk-deploy/main.ts.template'),
            'utf-8',
          ).replace(/<% TEST_RUN_ID %>/g, testRunId),
        );
      } else {
        writeFileSync(
          `${projectRoot}/packages/infra/src/main.tf`,
          readFileSync(
            join(__dirname, '../files/container-deploy/main.tf.template'),
            'utf-8',
          ).replace(/<% TEST_RUN_ID %>/g, testRunId),
        );

        // A state file per run, so parallel and earlier runs never collide.
        const infraProjectJsonPath = `${projectRoot}/packages/infra/project.json`;
        const infraProjectJson = JSON.parse(
          readFileSync(infraProjectJsonPath, 'utf-8'),
        );
        infraProjectJson.targets.init.configurations.dev.env = {
          ...(infraProjectJson.targets.init.configurations.dev.env ?? {}),
          TF_ENV: `container-deploy-${testRunId}`,
        };
        writeFileSync(
          infraProjectJsonPath,
          JSON.stringify(infraProjectJson, null, 2),
        );
      }

      // Auto-apply sync so the rewritten entry point doesn't block the deploy
      // with an "out of sync" error.
      const nxJsonPath = `${projectRoot}/nx.json`;
      const nxJson = JSON.parse(readFileSync(nxJsonPath, 'utf-8'));
      nxJson.sync = { ...(nxJson.sync ?? {}), applyChanges: true };
      writeFileSync(nxJsonPath, JSON.stringify(nxJson, null, 2));

      const cdkStageName = `e2e-test-infra-sandbox-${testRunId}`;

      try {
        await runCLI(`sync`, opts);

        let tsServiceUrl: string;
        let pyServiceUrl: string;
        if (iac === 'cdk') {
          await runCLI(
            `deploy infra ${cdkStageName}/* --output-style=stream`,
            opts,
          );
          const outputs =
            (
              await new CloudFormation().describeStacks({
                StackName: `${cdkStageName}-Application`,
              })
            ).Stacks?.[0]?.Outputs ?? [];
          const findOutput = (keyPrefix: string): string => {
            const output = outputs.find((o) =>
              o.OutputKey?.startsWith(keyPrefix),
            );
            if (!output?.OutputValue) {
              throw new Error(`Output with key prefix ${keyPrefix} not found`);
            }
            return output.OutputValue;
          };
          tsServiceUrl = findOutput('TsServiceUrl');
          pyServiceUrl = findOutput('PyServiceUrl');
        } else {
          // `bootstrap` re-applies the shared state bucket and rewrites its
          // bootstrap.tfstate, so run it only when the bucket is missing.
          if (await terraformStateBucketExists()) {
            console.log('Terraform state bucket exists; skipping bootstrap');
          } else {
            await runCLI(`bootstrap infra --output-style=stream`, opts);
          }
          await applyInfra(opts);
          const outputs = readTerraformOutputs(projectRoot);
          console.log('Terraform outputs:', outputs);
          tsServiceUrl = outputs.ts_service_url;
          pyServiceUrl = outputs.py_service_url;
        }

        await invokeContainerHealth(
          tsServiceUrl,
          'TypeScript container service',
        );
        await invokeContainerHealth(pyServiceUrl, 'Python container service');
        await invokeIamApiNoAuthDenied(
          tsServiceUrl,
          'TypeScript container service',
        );
        await invokeIamApiNoAuthDenied(
          pyServiceUrl,
          'Python container service',
        );
      } finally {
        if (iac === 'cdk') {
          try {
            await runCLI(
              `destroy infra ${cdkStageName}/* --output-style=stream --force`,
              opts,
            );
          } catch (e) {
            console.warn(`cdk destroy failed: ${e}`);
          }
        } else {
          try {
            await runCLI(
              `destroy infra --output-style=stream -- -auto-approve`,
              opts,
            );
          } catch (e) {
            console.warn(`terraform destroy failed: ${e}`);
          }
        }
      }
    });
  });
});
