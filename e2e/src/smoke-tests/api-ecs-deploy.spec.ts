/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
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
import { assertEcsHostedApiPathIsPrivate } from './api-ecs-deploy-assertions';
import {
  assertNoLeftovers,
  describeCdkStage,
  emptyResourceIds,
  findLeftoverCdkStacks,
  findLeftoverResources,
} from './container-deploy-leftovers';
import {
  getRegion,
  invokeIamApiNoAuthDenied,
  invokeTrpcApi,
} from './deploy-invocations';

/**
 * api-ecs-deploy smoke test: deploys the APIs the API generators host as a
 * container service on Amazon ECS (`--infra=http-ecs`) and calls each one.
 *
 * Only the CDK provider implements `http-ecs`, so there is no Terraform
 * variant. Each API gets an API Gateway HTTP API, a VPC link, an internal
 * Application Load Balancer with its own access log bucket, and a one-task
 * Fargate service. Every API in the stack shares one VPC with one NAT gateway,
 * so the run pays for one of each however many APIs it deploys.
 *
 * Each API is called twice: once with a SigV4-signed request, which must
 * answer 200 with the echoed message, and once unsigned, which the HTTP API's
 * IAM authorizer must reject with 401 or 403. The signed call is the only proof
 * that the whole private request path works — authorizer, VPC link, load
 * balancer, target group health check and the container's own server — and the
 * unsigned one is the proof that the API is not open.
 *
 * Both calls go to the API Gateway URL, so neither says anything about how the
 * request reaches the task. Three read-only describe calls per API do: the
 * load balancer's scheme is `internal`, the tasks get no public IP, and the
 * service's security group has exactly one inbound rule, from the load
 * balancer's own security group.
 *
 * Everything is destroyed in `finally`, and the leftover check
 * `container-deploy` uses then confirms, with read-only calls, that no stack,
 * stack resource or named resource is left. The load balancer, its listener and
 * target group, the VPC link and the VPC are CloudFormation resources of the
 * deleted stack, so `findLeftoverCdkStacks` covers them; the access log bucket
 * is checked by name with S3 as well, like every other bucket a deploy test
 * creates.
 *
 * It has a workspace of its own, rather than the full generator matrix, so that
 * `cdk-deploy` does not deploy a VPC, NAT gateway, load balancer or Fargate
 * service: that lane has the least headroom under the three-hour IAM session
 * limit. The matrix workspace still synthesises these APIs and runs checkov
 * over them, in the CDK app no lane deploys
 * (`e2e/src/files/application-stack-ecs.ts.template`). Like the other deploy
 * lanes it runs only on pushes to `main` (`.github/workflows/ci.yml`).
 */
describe('smoke test - api-ecs-deploy', () => {
  const pkgMgr = 'pnpm';
  const targetDir = `${tmpProjPath()}/api-ecs-deploy-${pkgMgr}`;

  beforeEach(() => {
    console.log(`Cleaning target directory ${targetDir}`);
    if (existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
    ensureDirSync(targetDir);
    pinAwsScopeToLocalRegistry(targetDir);
  });

  it('should deploy the ECS-hosted APIs and call each one signed and unsigned', async () => {
    const projectRoot = await createTestWorkspace(
      pkgMgr,
      targetDir,
      'e2e-test',
      'cdk',
    );
    const opts = {
      cwd: projectRoot,
      env: {
        NX_DAEMON: 'false',
        NODE_OPTIONS: '--max-old-space-size=8192',
      },
    };

    await runCLI(
      `generate @aws/nx-plugin:ts#infra --name=infra --no-interactive`,
      opts,
    );

    // Nothing beyond `--infra` and `--auth` is passed: the integration pattern
    // defaults to `shared` for this infra, so the lane deploys what a user who
    // passes `--infra=http-ecs` alone gets.
    await runCLI(
      `generate @aws/nx-plugin:ts#api --name=my-api --infra=http-ecs --auth=iam --no-interactive`,
      opts,
    );

    writeFileSync(
      `${projectRoot}/aws-nx-plugin.config.mts`,
      readFileSync(
        join(__dirname, '../files/aws-nx-plugin.config.mts.template'),
        'utf-8',
      ),
    );

    // Swap in the stack that puts every API in one VPC before the build, so
    // the build synthesises it and checkov scans it.
    writeFileSync(
      `${projectRoot}/packages/infra/src/stacks/application-stack.ts`,
      readFileSync(
        join(
          __dirname,
          '../files/api-ecs-deploy/application-stack.ts.template',
        ),
        'utf-8',
      ),
    );

    await runInstall(opts);
    await runCLI(`sync --verbose`, opts);
    // Sync writes local workspace dependencies into project manifests.
    await runInstall(opts);
    await runCLI(
      `run-many --target build --all --output-style=stream --verbose`,
      opts,
    );

    const testRunId = Math.random().toString(36).substring(2, 10);

    // Removal policies set to destroy, deletion protection off, and stack
    // names unique to this run.
    writeFileSync(
      `${projectRoot}/packages/infra/src/main.ts`,
      readFileSync(
        join(__dirname, '../files/cdk-deploy/main.ts.template'),
        'utf-8',
      ).replace(/<% TEST_RUN_ID %>/g, testRunId),
    );

    // Auto-apply sync so the rewritten entry point doesn't block the deploy
    // with an "out of sync" error.
    const nxJsonPath = `${projectRoot}/nx.json`;
    const nxJson = JSON.parse(readFileSync(nxJsonPath, 'utf-8'));
    nxJson.sync = { ...(nxJson.sync ?? {}), applyChanges: true };
    writeFileSync(nxJsonPath, JSON.stringify(nxJson, null, 2));

    const cdkStageName = `e2e-test-infra-sandbox-${testRunId}`;

    // Kept so the leftover check below can name it if it also fails.
    let testError: unknown;
    try {
      await runCLI(`sync`, opts);

      await runCLI(
        `deploy infra ${cdkStageName}/* --output-style=stream`,
        opts,
      );

      const outputs =
        (
          await new CloudFormation({ region: getRegion() }).describeStacks({
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

      const myApiUrl = output('MyApiUrl');
      await invokeTrpcApi(myApiUrl, 'tRPC ECS API');
      await invokeIamApiNoAuthDenied(myApiUrl, 'tRPC ECS API');

      // Both calls above go to the API Gateway URL, so neither would notice
      // an internet-facing load balancer, a public task IP or a wider
      // security group. These describe calls would.
      await assertEcsHostedApiPathIsPrivate({
        label: 'MyApi',
        loadBalancerArn: output('MyApiLoadBalancerArn'),
        clusterArn: output('MyApiClusterArn'),
        serviceName: output('MyApiServiceName'),
        serviceSecurityGroupId: output('MyApiServiceSecurityGroupId'),
      });
    } catch (e) {
      testError = e;
      throw e;
    } finally {
      // Before destroy, record what to check afterwards: the stacks' ids (a
      // deleted stack can only be looked up by id) and the ids of the
      // resources whose deletion is confirmed with their own service.
      let stackIds: string[] = [];
      let resourceIds = emptyResourceIds();
      const leftovers: string[] = [];
      try {
        ({ stackIds, resourceIds } = await describeCdkStage(cdkStageName));
      } catch (e) {
        leftovers.push(`Could not list the deployed resources: ${e}`);
      }

      try {
        await runCLI(
          `destroy infra ${cdkStageName}/* --output-style=stream --force`,
          opts,
        );
      } catch (e) {
        console.warn(`cdk destroy failed: ${e}`);
      }

      // Read-only: fails the test if anything the test created is left.
      try {
        leftovers.push(
          ...(await findLeftoverCdkStacks(cdkStageName, stackIds)),
          ...(await findLeftoverResources(resourceIds)),
        );
      } catch (e) {
        leftovers.push(`The leftover check could not finish: ${e}`);
      }
      assertNoLeftovers(leftovers, testError);
    }
  });
});
