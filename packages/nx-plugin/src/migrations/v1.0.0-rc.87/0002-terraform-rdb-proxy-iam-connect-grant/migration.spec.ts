/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const MYSQL_FILE =
  'packages/common/terraform/src/app/dbs/my-sql-db/my-sql-db.tf';
const POSTGRES_FILE =
  'packages/common/terraform/src/app/dbs/postgres-db/postgres-db.tf';

/** The pre-change shape of a vended MySQL database app module. */
const MYSQL_BEFORE = `resource "aws_iam_role_policy" "proxy_db_user_connect" {
  count = var.enable_rds_proxy ? 1 : 0

  role = module.aurora.proxy_role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [module.aurora.secret_arn]
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt"
        ]
        Resource = [module.aurora.kms_key_arn]
      }
    ]
  })
}
`;

/** The vended Postgres shape, which already has the grant. */
const POSTGRES_BEFORE = `resource "aws_iam_role_policy" "proxy_db_user_connect" {
  count = var.enable_rds_proxy ? 1 : 0

  role = module.aurora.proxy_role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["rds-db:connect"]
        Resource = [
          "arn:aws:rds-db:\${data.aws_region.current.region}:\${data.aws_caller_identity.current.account_id}:dbuser:\${module.aurora.cluster_resource_id}/\${local.database_runtime_user}"
        ]
      }
    ]
  })
}
`;

describe('terraform-rdb-proxy-iam-connect-grant migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should replace the mysql admin secret grant with rds-db:connect', async () => {
    tree.write(MYSQL_FILE, MYSQL_BEFORE);

    const result = await migration(tree);

    const content = tree.read(MYSQL_FILE, 'utf-8');
    expect(content).toContain('Action = ["rds-db:connect"]');
    expect(content).toContain(
      'dbuser:${module.aurora.cluster_resource_id}/${local.database_runtime_user}',
    );
    // The proxy authenticates with IAM, so it must no longer hold the admin
    // credentials.
    expect(content).not.toContain('secretsmanager:GetSecretValue');
    expect(content).not.toContain('kms:Decrypt');
    expect(result.nextSteps).toEqual([]);
    expect(content).toMatchSnapshot();
  });

  it('should leave a module that already grants rds-db:connect alone', async () => {
    tree.write(POSTGRES_FILE, POSTGRES_BEFORE);

    const result = await migration(tree);

    expect(tree.read(POSTGRES_FILE, 'utf-8')).toBe(POSTGRES_BEFORE);
    expect(result.nextSteps).toEqual([]);
  });

  it('should do nothing when the workspace has no terraform database modules', async () => {
    const result = await migration(tree);

    expect(result.nextSteps).toEqual([]);
    expect(tree.exists(MYSQL_FILE)).toBe(false);
  });

  it('should skip and report a customised policy', async () => {
    const customised = MYSQL_BEFORE.replace(
      '        Resource = [module.aurora.kms_key_arn]',
      '        Resource = [module.aurora.kms_key_arn, var.my_other_key_arn]',
    );
    tree.write(MYSQL_FILE, customised);

    const result = await migration(tree);

    expect(tree.read(MYSQL_FILE, 'utf-8')).toBe(customised);
    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps[0]).toContain(MYSQL_FILE);
    expect(result.nextSteps[0]).toContain('rds-db:connect');
  });

  it('should ignore a module with no proxy policy', async () => {
    const noProxyPolicy = `module "aurora" {
  source = "../../../core/rdb/aurora"
  name   = "my-sql-db"
}
`;
    tree.write(MYSQL_FILE, noProxyPolicy);

    const result = await migration(tree);

    expect(tree.read(MYSQL_FILE, 'utf-8')).toBe(noProxyPolicy);
    expect(result.nextSteps).toEqual([]);
  });

  it('should be idempotent', async () => {
    tree.write(MYSQL_FILE, MYSQL_BEFORE);
    tree.write(POSTGRES_FILE, POSTGRES_BEFORE);

    await migration(tree);
    const afterFirst = {
      mysql: tree.read(MYSQL_FILE, 'utf-8'),
      postgres: tree.read(POSTGRES_FILE, 'utf-8'),
    };

    const result = await migration(tree);

    expect(tree.read(MYSQL_FILE, 'utf-8')).toBe(afterFirst.mysql);
    expect(tree.read(POSTGRES_FILE, 'utf-8')).toBe(afterFirst.postgres);
    expect(result.nextSteps).toEqual([]);

    // Exactly one statement per file, not a second appended copy.
    for (const content of Object.values(afterFirst)) {
      expect(content?.match(/rds-db:connect/g)).toHaveLength(1);
    }
  });
});
