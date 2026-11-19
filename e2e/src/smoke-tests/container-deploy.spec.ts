/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
import { addContainerStartupChecks } from './container-connection-fixtures';
import {
  assertContainerServiceIsPrivate,
  type DeployedContainerService,
  waitForE2eChecks,
  waitForHealthyTasks,
} from './container-deploy-invocations';
import {
  assertNoLeftovers,
  describeCdkStage,
  emptyResourceIds,
  findLeftoverCdkStacks,
  findLeftoverResources,
  findLeftoverTerraformState,
} from './container-deploy-leftovers';
import { ensureRdsServiceLinkedRole } from './deploy-prerequisites';
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

/** The deployed services, and the startup checks each must pass. */
const SERVICES = [
  {
    label: 'TsService',
    outputKey: 'TsService',
    terraformOutput: 'ts_service',
    expectedChecks: ['ts-service-my-table', 'ts-service-postgres-db'],
  },
  {
    label: 'PyService',
    outputKey: 'PyService',
    terraformOutput: 'py_service',
    expectedChecks: ['py-service-my-py-table', 'py-service-py-postgres-db'],
  },
] as const;

/**
 * container-deploy smoke tests: deploy one `ts#container` service
 * (`ts-service`) and one `py#container` service (`py-service`) into a VPC
 * the test creates, together with the far ends of the four container data
 * connections, and check that every connection works and that both services
 * stay private. `container-deploy` deploys with CDK and
 * `container-deploy-terraform` with Terraform; each is its own CI job,
 * because both in one job would outlast the job's 3-hour AWS role session.
 *
 * Each service is the source of its language's data connections:
 *
 * - each service -> its language's DynamoDB table (`my-table`,
 *   `my-py-table`).
 * - each service -> its language's rdb (`postgres-db`, `py-postgres-db`).
 *   Both services use one Aurora PostgreSQL cluster, deployed by the
 *   `ts#rdb` construct or module; the Python client is given that
 *   cluster's settings under its own runtime-config key (see the stack
 *   templates in `files/container-deploy`). So the `py#rdb` construct or
 *   module, its Alembic migration and its create-db-user Lambda are not
 *   deployed here; the rdb deploy tests (`cdk-deploy-rdb`,
 *   `terraform-deploy-rdb`) deploy them. The rdb generators vend no
 *   migration, so the test writes a first Prisma migration that creates the
 *   tables both services use.
 *
 * A service has no load balancer and its security group gets no inbound
 * rule, so the test cannot call it, and does not open it. Instead the test
 * adds a startup check to each service (`container-connection-fixtures.ts`):
 * once the server listens, the service writes and reads one DynamoDB item
 * and inserts and selects one database row through the vended clients, and
 * logs one `E2E_CHECK` line per connection with a token that is random per
 * run. After deploy the test, with read-only calls, checks that each service
 * runs a task, has no load balancer, no public IP and no inbound permission
 * on its security group, that its containers are `HEALTHY`, and that its
 * log group holds an `ok: true` line with this run's token for each of its
 * connections.
 *
 * Everything is destroyed in `finally`. After destroy it checks, with
 * read-only calls, that no stack, Terraform state entry or named resource
 * (DynamoDB tables, buckets, AppConfig application, Aurora cluster and its
 * secret) is left, and fails the test if one is.
 *
 * It builds a small workspace of its own rather than the full generator
 * matrix, and runs only on pushes to `main` (`.github/workflows/ci.yml`).
 */
function describeContainerDeploy(
  variant: 'container-deploy' | 'container-deploy-terraform',
  iac: 'cdk' | 'terraform',
) {
  describe(`smoke test - ${variant}`, () => {
    const pkgMgr = 'pnpm';
    const targetDir = `${tmpProjPath()}/container-deploy-${iac}-${pkgMgr}`;

    beforeEach(() => {
      console.log(`Cleaning target directory ${targetDir}`);
      if (existsSync(targetDir)) {
        rmSync(targetDir, { force: true, recursive: true });
      }
      ensureDirSync(targetDir);
      pinAwsScopeToLocalRegistry(targetDir);
    });

    it(`should deploy the private container services and check their connections with iac=${iac}`, async () => {
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

      // The two services, and the generators at the far ends of their
      // connections.
      for (const command of [
        'ts#project --name=ts-project',
        'ts#container --project=ts-project --name=ts-service',
        'py#project --name=py-project --type=application',
        'py#container --project=py_project --name=py-service',
        'ts#dynamodb --name=my-table',
        'py#dynamodb --name=my-py-table',
        'ts#rdb --name=postgres-db',
        'py#rdb --name=py-postgres-db',
      ]) {
        await runCLI(
          `generate @aws/nx-plugin:${command} --no-interactive`,
          opts,
        );
      }

      // The four container data connections.
      for (const connection of [
        '--sourceProject=ts-project --sourceComponent=ts-service --targetProject=postgres-db',
        '--sourceProject=py_project --sourceComponent=py-service --targetProject=py_postgres_db',
        '--sourceProject=ts-project --sourceComponent=ts-service --targetProject=@e2e-test/my-table',
        '--sourceProject=py_project --sourceComponent=py-service --targetProject=my_py_table',
      ]) {
        await runCLI(
          `generate @aws/nx-plugin:connection ${connection} --no-interactive`,
          opts,
        );
      }
      // Before sync, so sync records ts-project's new import of my-table.
      await addContainerStartupChecks(projectRoot);

      // Random per run; each service logs it with its startup check results.
      const checkToken = randomUUID();

      writeFileSync(
        `${projectRoot}/aws-nx-plugin.config.mts`,
        readFileSync(
          join(__dirname, '../files/aws-nx-plugin.config.mts.template'),
          'utf-8',
        ),
      );

      // Swap in the stack that wires both services into a VPC, and the
      // connections' far ends and grants, before the build, so the build
      // synthesises and scans it.
      if (iac === 'cdk') {
        writeFileSync(
          `${projectRoot}/packages/infra/src/stacks/application-stack.ts`,
          readFileSync(
            join(
              __dirname,
              '../files/container-deploy/application-stack.ts.template',
            ),
            'utf-8',
          ).replace(/<% E2E_CHECK_TOKEN %>/g, checkToken),
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
        // Removal policies set to destroy, deletion protection off, and stack
        // names unique to this run.
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
          )
            .replace(/<% TEST_RUN_ID %>/g, testRunId)
            .replace(/<% E2E_CHECK_TOKEN %>/g, checkToken),
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

        // As in terraform-deploy: the tables' and the Aurora cluster's
        // literal `prevent_destroy = true` flipped (a variable cannot drive
        // it), so `terraform destroy` removes them in one pass. main.tf
        // already disables the tables' deletion_protection_enabled and the
        // cluster's deletion_protection.
        const terraformSrc = `${projectRoot}/packages/common/terraform/src`;
        for (const relativeTfPath of [
          'core/dynamodb/dynamodb.tf',
          'core/rdb/aurora/aurora.tf',
        ]) {
          const tfPath = `${terraformSrc}/${relativeTfPath}`;
          writeFileSync(
            tfPath,
            readFileSync(tfPath, 'utf-8').replace(
              /prevent_destroy\s*=\s*true/g,
              'prevent_destroy = false',
            ),
          );
        }
      }

      // Auto-apply sync so the rewritten entry point doesn't block the deploy
      // with an "out of sync" error.
      const nxJsonPath = `${projectRoot}/nx.json`;
      const nxJson = JSON.parse(readFileSync(nxJsonPath, 'utf-8'));
      nxJson.sync = { ...(nxJson.sync ?? {}), applyChanges: true };
      writeFileSync(nxJsonPath, JSON.stringify(nxJson, null, 2));

      const cdkStageName = `e2e-test-infra-sandbox-${testRunId}`;
      const infraSrcDir = join(projectRoot, 'packages/infra/src');

      ensureRdsServiceLinkedRole();

      // Kept so the leftover check below can name it if it also fails.
      let testError: unknown;
      try {
        await runCLI(`sync`, opts);

        // Log lines from before this deploy cannot hold this run's token, so
        // reading from here on only saves time.
        const deployStartedAt = Date.now();
        let services: DeployedContainerService[];
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
          const output = (key: string): string => {
            const value = outputs.find((o) => o.OutputKey === key)?.OutputValue;
            if (!value) {
              throw new Error(`Stack output ${key} not found`);
            }
            return value;
          };
          services = SERVICES.map(({ label, outputKey, expectedChecks }) => ({
            label,
            clusterArn: output(`${outputKey}ClusterArn`),
            serviceName: output(`${outputKey}Name`),
            securityGroupId: output(`${outputKey}SecurityGroupId`),
            logGroupName: output(`${outputKey}LogGroupName`),
            expectedChecks: [...expectedChecks],
          }));
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
          const output = (name: string): string => {
            const value = outputs[name];
            if (!value || value === 'null' || value === 'undefined') {
              throw new Error(`Terraform output ${name} not found`);
            }
            return value;
          };
          services = SERVICES.map(
            ({ label, terraformOutput, expectedChecks }) => ({
              label,
              clusterArn: output(`${terraformOutput}_cluster_arn`),
              serviceName: output(`${terraformOutput}_name`),
              securityGroupId: output(`${terraformOutput}_security_group_id`),
              logGroupName: output(`${terraformOutput}_log_group_name`),
              expectedChecks: [...expectedChecks],
            }),
          );
        }

        for (const service of services) {
          await assertContainerServiceIsPrivate(service);
          await waitForHealthyTasks(service);
          await waitForE2eChecks(service, checkToken, deployStartedAt);
        }
      } catch (e) {
        testError = e;
        throw e;
      } finally {
        // Before destroy, record what to check afterwards: the stacks' ids
        // (a deleted stack can only be looked up by id) and the ids of the
        // resources whose deletion is confirmed with their own service.
        let stackIds: string[] = [];
        let resourceIds = emptyResourceIds();
        const leftovers: string[] = [];
        try {
          if (iac === 'cdk') {
            ({ stackIds, resourceIds } = await describeCdkStage(cdkStageName));
          } else if (existsSync(join(infraSrcDir, '.terraform'))) {
            const outputs = readTerraformOutputs(projectRoot);
            const ids = (...names: string[]) =>
              names
                .map((name) => outputs[name])
                .filter((v) => v && v !== 'null' && v !== 'undefined');
            resourceIds = {
              tableNames: ids('my_table_name', 'my_py_table_name'),
              bucketNames: ids('asset_bucket_name'),
              appConfigApplicationIds: ids('runtime_config_application_id'),
              dbClusterIds: ids('postgres_db_cluster_arn'),
              secretIds: ids('postgres_db_secret_arn'),
            };
          }
        } catch (e) {
          leftovers.push(`Could not list the deployed resources: ${e}`);
        }

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

        // Read-only: fails the test if anything the test created is left.
        try {
          leftovers.push(
            ...(iac === 'cdk'
              ? await findLeftoverCdkStacks(cdkStageName, stackIds)
              : findLeftoverTerraformState(infraSrcDir)),
            ...(await findLeftoverResources(resourceIds)),
          );
        } catch (e) {
          leftovers.push(`The leftover check could not finish: ${e}`);
        }
        assertNoLeftovers(leftovers, testError);
      }
    });
  });
}

describeContainerDeploy('container-deploy', 'cdk');
describeContainerDeploy('container-deploy-terraform', 'terraform');
