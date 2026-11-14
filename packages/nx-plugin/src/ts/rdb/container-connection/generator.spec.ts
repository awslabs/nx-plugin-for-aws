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
  TS_RDB_CONTAINER_CONNECTION_GENERATOR_INFO,
  tsRdbContainerConnectionGenerator,
} from './generator.js';
import {
  cdkRdbContainerWiring,
  dataStoreNames,
  terraformRdbContainerWiring,
} from './wiring.js';

const GUIDE_FILE = join(
  import.meta.dirname,
  '../../../../../../docs/src/content/docs/en/guides/connection/ts-container-rdb.mdx',
);
const SERVICE_DIR = 'packages/svc/src/orders';
const GETTER = `${SERVICE_DIR}/my-db.ts`;
const DOCKERFILE = `${SERVICE_DIR}/Dockerfile`;

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
  ingress: 'http-api',
  auth: 'iam',
  iac: 'cdk',
  ...overrides,
});

describe('ts#rdb#container-connection generator', () => {
  let tree: Tree;

  const run = (overrides: Record<string, unknown> = {}) =>
    tsRdbContainerConnectionGenerator(tree, {
      sourceProject: 'svc',
      targetProject: '@proj/my-db',
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
    // The container lanes vend the Dockerfile; this is the shape the RDS CA
    // bundle injection looks for.
    tree.write(
      DOCKERFILE,
      `FROM public.ecr.aws/docker/library/node:lts-jod

WORKDIR /app
COPY index.js /app

EXPOSE 8080

CMD [ "node", "index.js" ]
`,
    );
    tree.write(
      'packages/my-db/project.json',
      JSON.stringify({
        name: '@proj/my-db',
        root: 'packages/my-db',
        targets: { dev: { executor: 'nx:run-commands', continuous: true } },
      }),
    );
  });

  it('should vend a getter for the database next to the service', async () => {
    await run();

    expect(tree.read(GETTER, 'utf-8')).toMatchSnapshot();
  });

  it('should install the RDS CA bundle in the Dockerfile', async () => {
    await run();

    expect(tree.read(DOCKERFILE, 'utf-8')).toMatchSnapshot();
  });

  it('should not fail when the service has no Dockerfile', async () => {
    tree.delete(DOCKERFILE);

    await expect(run()).resolves.toBeDefined();
    expect(tree.exists(DOCKERFILE)).toBe(false);
  });

  it("should start the database with the service's serve target", async () => {
    await run();

    expect(
      readProjectConfiguration(tree, 'svc').targets?.['orders-serve'].dependsOn,
    ).toEqual([{ projects: ['@proj/my-db'], target: 'dev' }]);
  });

  it('should change nothing on a second run', async () => {
    await run();
    const first = changedFiles(tree);

    await run();

    expect(changedFiles(tree)).toEqual(first);
  });

  it('should reject a service with no infrastructure', async () => {
    await expect(
      run({ infra: 'none', ingress: undefined, auth: undefined }),
    ).rejects.toThrow(
      "Cannot connect svc (orders) to @proj/my-db: Access is granted to the container service's ECS task role, which only infra ecs creates.",
    );
  });

  describe('wiring message', () => {
    it('should print the CDK grants', async () => {
      expect(await runAndCaptureInfo()).toEqual([
        `Let the Orders container service connect to the MyDb database. Add this to your stack, for example packages/infra/src/stacks/application-stack.ts, where orders is your Orders construct and myDb is your MyDb construct. Until you add it, the service cannot reach the database port and its IAM authentication is refused.

myDb.allowDefaultPortFrom(orders);
myDb.grantConnect(orders.taskRole);`,
      ]);
    });

    it('should print the Terraform policy and security group rules', async () => {
      expect(await runAndCaptureInfo({ iac: 'terraform' })).toEqual([
        `Let the Orders container service connect to the MyDb database. Add this to the root Terraform module that deploys both, for example packages/infra/src/main.tf, where module "orders" deploys the service and module "my_db" deploys the database. Until you add it, the service cannot reach the database port and its IAM authentication is refused.

resource "aws_iam_role_policy" "orders_my_db_connect" {
  name = "orders-my-db-connect"
  role = module.orders.task_role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["rds-db:connect"]
        Resource = ["arn:aws:rds-db:\${data.aws_region.current.region}:\${data.aws_caller_identity.current.account_id}:dbuser:\${module.my_db.connect_resource_id}/\${module.my_db.database_runtime_user}"]
      },
    ]
  })
}

resource "aws_vpc_security_group_ingress_rule" "orders_to_my_db" {
  description                  = "Allow the orders container service to connect to the database"
  security_group_id            = module.my_db.security_group_id
  referenced_security_group_id = module.orders.security_group_id
  from_port                    = module.my_db.cluster_port
  to_port                      = module.my_db.cluster_port
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "orders_to_my_db" {
  description                  = "Allow the orders container service to reach the database"
  security_group_id            = module.orders.security_group_id
  referenced_security_group_id = module.my_db.security_group_id
  from_port                    = module.my_db.cluster_port
  to_port                      = module.my_db.cluster_port
  ip_protocol                  = "tcp"
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
        const db = dataStoreNames('@my-scope/my-database');
        const code =
          iac === 'cdk'
            ? cdkRdbContainerWiring(serviceNames, db)
            : terraformRdbContainerWiring(serviceNames, db);

        expect(readFileSync(GUIDE_FILE, 'utf-8')).toContain(code);
      },
    );
  });

  it('should record the connection on the service project', async () => {
    await run();

    expect(
      readProjectConfiguration(tree, 'svc').metadata?.components,
    ).toContainEqual({
      generator: TS_RDB_CONTAINER_CONNECTION_GENERATOR_INFO.id,
      name: 'orders-myDb',
      path: 'src/orders/my-db.ts',
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
      TS_RDB_CONTAINER_CONNECTION_GENERATOR_INFO.metric,
    );
  });
});
