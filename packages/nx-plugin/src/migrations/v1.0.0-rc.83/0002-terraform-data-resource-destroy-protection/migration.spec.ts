/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const DYNAMODB_FILE = 'packages/common/terraform/src/core/dynamodb/dynamodb.tf';
const AURORA_FILE = 'packages/common/terraform/src/core/rdb/aurora/aurora.tf';

/**
 * The pre-change shape of the vended DynamoDB core module: a KMS key with no
 * pending window, and a table guarded only by the service-side flag.
 */
const DYNAMODB_BEFORE = `resource "aws_kms_key" "table" {
  count = local.create_table_key ? 1 : 0

  description         = "KMS key for DynamoDB table \${var.name}"
  enable_key_rotation = var.enable_key_rotation
}

resource "aws_dynamodb_table" "table" {
  name                        = var.name
  billing_mode                = var.billing_mode
  hash_key                    = "pk"
  range_key                   = "sk"
  deletion_protection_enabled = var.deletion_protection_enabled

  attribute {
    name = "pk"
    type = "S"
  }

  point_in_time_recovery {
    enabled = var.point_in_time_recovery_enabled
  }

  server_side_encryption {
    enabled     = var.encryption != "DEFAULT"
    kms_key_arn = local.table_kms_key_arn
  }
}
`;

/** The pre-change shape of the vended Aurora core module. */
const AURORA_BEFORE = `resource "aws_kms_key" "database" {
  description         = "KMS key for Aurora cluster \${var.name}"
  enable_key_rotation = var.enable_key_rotation

  tags = merge(var.tags, {
    Name = "\${var.name}-aurora"
  })
}

resource "aws_rds_cluster" "database" {
  cluster_identifier  = local.cluster_name
  engine              = var.engine
  storage_encrypted   = true
  kms_key_id          = aws_kms_key.database.arn
  deletion_protection = var.deletion_protection
  skip_final_snapshot = var.skip_final_snapshot

  serverlessv2_scaling_configuration {
    min_capacity = var.serverless_min_capacity
    max_capacity = var.serverless_max_capacity
  }

  tags = merge(var.tags, {
    Name = "\${var.name}-aurora"
  })
}
`;

describe('terraform-data-resource-destroy-protection migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should protect the dynamodb table and pin its key window', async () => {
    tree.write(DYNAMODB_FILE, DYNAMODB_BEFORE);

    const result = await migration(tree);

    const content = tree.read(DYNAMODB_FILE, 'utf-8');
    expect(content).toContain('prevent_destroy = true');
    expect(content).toContain('deletion_window_in_days = 30');
    // The service-side flag stays configurable - the lifecycle block is an
    // additional layer, not a replacement.
    expect(content).toContain(
      'deletion_protection_enabled = var.deletion_protection_enabled',
    );
    expect(result.nextSteps).toEqual([]);
    expect(content).toMatchSnapshot();
  });

  it('should protect the aurora cluster and pin its key window', async () => {
    tree.write(AURORA_FILE, AURORA_BEFORE);

    const result = await migration(tree);

    const content = tree.read(AURORA_FILE, 'utf-8');
    expect(content).toContain('prevent_destroy = true');
    expect(content).toContain('deletion_window_in_days = 30');
    expect(content).toContain('deletion_protection = var.deletion_protection');
    expect(result.nextSteps).toEqual([]);
    expect(content).toMatchSnapshot();
  });

  it('should do nothing when the workspace has no terraform modules', async () => {
    const result = await migration(tree);

    expect(result.nextSteps).toEqual([]);
    expect(tree.exists(DYNAMODB_FILE)).toBe(false);
    expect(tree.exists(AURORA_FILE)).toBe(false);
  });

  it('should skip and report a customised file', async () => {
    const customised = `resource "aws_dynamodb_table" "my_own_table" {
  name = "custom"
}
`;
    tree.write(DYNAMODB_FILE, customised);

    const result = await migration(tree);

    expect(tree.read(DYNAMODB_FILE, 'utf-8')).toBe(customised);
    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps[0]).toContain(DYNAMODB_FILE);
    expect(result.nextSteps[0]).toContain('prevent_destroy');
  });

  it('should preserve an existing prevent_destroy setting', async () => {
    // A user who has deliberately turned the guard off keeps that choice.
    tree.write(
      DYNAMODB_FILE,
      DYNAMODB_BEFORE.replace(
        '  server_side_encryption {',
        '  lifecycle {\n    prevent_destroy = false\n  }\n\n  server_side_encryption {',
      ),
    );

    const result = await migration(tree);

    const content = tree.read(DYNAMODB_FILE, 'utf-8');
    expect(content).toContain('prevent_destroy = false');
    expect(content).not.toContain('prevent_destroy = true');
    expect(result.nextSteps).toEqual([]);
  });

  it('should be idempotent', async () => {
    tree.write(DYNAMODB_FILE, DYNAMODB_BEFORE);
    tree.write(AURORA_FILE, AURORA_BEFORE);

    await migration(tree);
    const afterFirst = {
      dynamodb: tree.read(DYNAMODB_FILE, 'utf-8'),
      aurora: tree.read(AURORA_FILE, 'utf-8'),
    };

    const result = await migration(tree);

    expect(tree.read(DYNAMODB_FILE, 'utf-8')).toBe(afterFirst.dynamodb);
    expect(tree.read(AURORA_FILE, 'utf-8')).toBe(afterFirst.aurora);
    expect(result.nextSteps).toEqual([]);

    // Exactly one guard and one window per file, not a second appended copy.
    for (const content of Object.values(afterFirst)) {
      expect(content?.match(/prevent_destroy/g)).toHaveLength(1);
      expect(content?.match(/deletion_window_in_days/g)).toHaveLength(1);
    }
  });
});
