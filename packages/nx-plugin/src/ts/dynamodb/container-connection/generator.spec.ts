/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger, readProjectConfiguration, type Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { declareDependencies } from '../../../utils/declared-dependencies.js';
import { expectHasMetricTags } from '../../../utils/metrics-assertions.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../../utils/shared-constructs.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import {
  TS_DYNAMODB_CONTAINER_CONNECTION_GENERATOR_INFO,
  tsDynamoDBContainerConnectionGenerator,
} from './generator.js';
import {
  cdkDynamoDBContainerWiring,
  dataStoreNames,
  terraformDynamoDBContainerWiring,
} from './wiring.js';

const GUIDE_FILE = join(
  import.meta.dirname,
  '../../../../../../docs/src/content/docs/en/guides/connection/ts-container-dynamodb.mdx',
);

const changedFiles = (tree: Tree): Record<string, string> =>
  Object.fromEntries(
    tree
      .listChanges()
      .filter((c) => c.type !== 'DELETE')
      .map((c) => [c.path, c.content?.toString('utf-8') ?? '']),
  );

const service = (overrides: Record<string, unknown> = {}) => ({
  generator: 'ts#container',
  name: 'orders',
  path: 'src/orders',
  port: 8083,
  rc: 'Orders',
  infra: 'ecs',
  iac: 'cdk',
  ...overrides,
});

describe('ts#dynamodb#container-connection generator', () => {
  let tree: Tree;

  const run = (overrides: Record<string, unknown> = {}) =>
    tsDynamoDBContainerConnectionGenerator(tree, {
      sourceProject: 'svc',
      targetProject: '@proj/my-table',
      sourceComponent: service(overrides),
    });

  const runAndCaptureInfo = async (
    overrides: Record<string, unknown> = {},
  ): Promise<string[]> => {
    const callback = await run(overrides);
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
    await callback();
    const messages = info.mock.calls.map((c) => String(c[0]));
    info.mockRestore();
    return messages;
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    tree.write(
      'packages/svc/project.json',
      JSON.stringify({
        name: 'svc',
        root: 'packages/svc',
        sourceRoot: 'packages/svc/src',
        targets: {
          'orders-serve': { executor: 'nx:run-commands', continuous: true },
        },
        metadata: { components: [service()] },
      }),
    );
    tree.write(
      'packages/my-table/project.json',
      JSON.stringify({
        name: '@proj/my-table',
        root: 'packages/my-table',
        targets: { dev: { executor: 'nx:run-commands', continuous: true } },
      }),
    );
  });

  it("should start the table with the service's serve target", async () => {
    await run();

    expect(
      readProjectConfiguration(tree, 'svc').targets?.['orders-serve'].dependsOn,
    ).toEqual([{ projects: ['@proj/my-table'], target: 'dev' }]);
  });

  it('should change nothing on a second run', async () => {
    await run();
    const first = changedFiles(tree);

    await run();

    expect(changedFiles(tree)).toEqual(first);
  });

  it('should reject a service with no infrastructure', async () => {
    await expect(run({ infra: 'none' })).rejects.toThrow(
      "Cannot connect svc (orders) to @proj/my-table: Access is granted to the container service's ECS task role, which only infra ecs creates.",
    );
  });

  describe('wiring message', () => {
    it('should print the CDK grant', async () => {
      expect(await runAndCaptureInfo()).toEqual([
        `Let the Orders container service read and write the MyTable table. Add this to your stack, for example packages/infra/src/stacks/application-stack.ts, where orders is your Orders construct and myTable is your MyTable construct. Until you add it, the service's requests to the table are denied.

myTable.grantReadWriteData(orders.taskRole);`,
      ]);
    });

    it('should print the Terraform policy', async () => {
      expect(await runAndCaptureInfo({ iac: 'terraform' })).toEqual([
        `Let the Orders container service read and write the MyTable table. Add this to the root Terraform module that deploys both, for example packages/infra/src/main.tf, where module "orders" deploys the service and module "my_table" deploys the table. Until you add it, the service's requests to the table are denied.

resource "aws_iam_role_policy" "orders_my_table_access" {
  name = "orders-my-table-access"
  role = module.orders.task_role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
          "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan",
          "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem",
        ]
        Resource = [
          module.my_table.table_arn,
          "\${module.my_table.table_arn}/index/*",
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:DescribeKey",
        ]
        Resource = [module.my_table.kms_key_arn]
      },
    ]
  })
}`,
      ]);
    });

    it.each(['cdk', 'terraform'] as const)(
      'should show the %s code in the guide',
      (iac) => {
        const serviceNames = {
          nameClassName: 'MyService',
          nameKebabCase: 'my-service',
          moduleName: 'my_service',
          variableName: 'myService',
        };
        const table = dataStoreNames('@my-scope/my-table');
        const code =
          iac === 'cdk'
            ? cdkDynamoDBContainerWiring(serviceNames, table)
            : terraformDynamoDBContainerWiring(serviceNames, table);

        expect(readFileSync(GUIDE_FILE, 'utf-8')).toContain(code);
      },
    );
  });

  it('should record the connection on the service project', async () => {
    await run();

    expect(
      readProjectConfiguration(tree, 'svc').metadata?.components,
    ).toContainEqual({
      generator: TS_DYNAMODB_CONTAINER_CONNECTION_GENERATOR_INFO.id,
      name: 'orders-@proj/my-table',
      path: 'packages/my-table',
      sourcePath: 'src/orders',
    });
  });

  it('should add the generator metric to app.ts', async () => {
    await sharedConstructsGenerator(
      tree,
      { iac: 'cdk' },
      declareDependencies()({ ts: [...SHARED_CONSTRUCTS_DEPENDENCIES] }),
    );

    await run();

    expectHasMetricTags(
      tree,
      TS_DYNAMODB_CONTAINER_CONNECTION_GENERATOR_INFO.metric,
    );
  });
});
