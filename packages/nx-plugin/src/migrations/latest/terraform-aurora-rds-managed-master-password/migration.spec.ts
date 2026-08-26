/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const AURORA_FILE = 'packages/common/terraform/src/core/rdb/aurora/aurora.tf';
const APP_MODULE_FILE = 'packages/common/terraform/src/app/dbs/my-db/my-db.tf';

/**
 * The pre-change shape of the vended Aurora core module: the master password is
 * minted by `random_password` and written into a secret version, so both land in
 * Terraform state.
 */
const AURORA_BEFORE = `variable "lambda_subnet_ids" {
  description = "Subnet IDs for the credential-rotation Lambda."
  type        = list(string)
}

variable "enable_credential_rotation" {
  description = "Whether to enable automatic credential rotation for the admin secret."
  type        = bool
  default     = true
}

resource "aws_kms_key" "database" {
  description = "KMS key for Aurora cluster \${var.name}"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowRDSService"
        Effect = "Allow"
        Principal = {
          Service = "rds.amazonaws.com"
        }
        Action   = ["kms:Decrypt"]
        Resource = "*"
      }
    ]
  })
}

resource "random_password" "master_password" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "aws_secretsmanager_secret" "credentials" {
  name_prefix = "\${var.name}-aurora-credentials-"
  kms_key_id  = aws_kms_key.database.arn
}

resource "aws_secretsmanager_secret_version" "credentials" {
  secret_id = aws_secretsmanager_secret.credentials.id
  secret_string = jsonencode({
    username = var.admin_user
    password = random_password.master_password.result
    host     = aws_rds_cluster.database.endpoint
  })
}

resource "aws_rds_cluster" "database" {
  cluster_identifier  = local.cluster_name
  engine              = var.engine
  master_username     = var.admin_user
  master_password     = random_password.master_password.result
  kms_key_id          = aws_kms_key.database.arn
  deletion_protection = var.deletion_protection

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_security_group" "rotation" {
  count       = var.enable_credential_rotation ? 1 : 0
  name_prefix = "\${var.name}-aurora-rotation-"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_egress_rule" "rotation_to_database" {
  count             = var.enable_credential_rotation ? 1 : 0
  security_group_id = aws_security_group.rotation[0].id
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "rotation_to_database" {
  count             = var.enable_credential_rotation ? 1 : 0
  security_group_id = aws_security_group.database.id
  ip_protocol       = "tcp"
}

resource "aws_cloudformation_stack" "credentials_rotation" {
  count = var.enable_credential_rotation ? 1 : 0
  name  = "\${local.cluster_name}-credentials-rotation"

  capabilities = ["CAPABILITY_IAM", "CAPABILITY_AUTO_EXPAND"]

  template_body = jsonencode({
    Transform = "AWS::SecretsManager-2024-09-16"
  })
}

output "reader_endpoint" {
  description = "Reader endpoint of the Aurora cluster."
  value       = aws_rds_cluster.database.reader_endpoint
}

output "secret_arn" {
  description = "ARN of the generated admin credentials secret."
  value       = aws_secretsmanager_secret.credentials.arn
}

output "admin_user" {
  description = "Admin username stored in the generated secret."
  value       = jsondecode(aws_secretsmanager_secret_version.credentials.secret_string).username
}
`;

/** The pre-change shape of a vended per-database Terraform app module. */
const APP_MODULE_BEFORE = `variable "enable_credential_rotation" {
  description = "Whether to enable automatic credential rotation for the admin secret."
  type        = bool
  default     = true
}

module "aurora" {
  source = "../../../core/rdb/aurora"

  name                       = "my-db"
  lambda_subnet_ids          = var.lambda_subnet_ids
  enable_rds_proxy           = var.enable_rds_proxy
  enable_credential_rotation = var.enable_credential_rotation
}

resource "aws_lambda_function" "create_db_user" {
  function_name = local.create_db_user_function_name

  environment {
    variables = {
      DATABASE_SECRET_ARN = module.aurora.secret_arn
    }
  }
}

resource "aws_lambda_function" "migration_handler" {
  function_name = local.migration_function_name

  environment {
    variables = {
      DATABASE_SECRET_ARN = module.aurora.secret_arn
    }
  }
}
`;

describe('terraform-aurora-rds-managed-master-password migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should hand the master password to RDS', async () => {
    tree.write(AURORA_FILE, AURORA_BEFORE);

    const result = await migration(tree);
    const content = tree.read(AURORA_FILE, 'utf-8')!;

    expect(content).toContain('manage_master_user_password');
    expect(content).toContain(
      'master_user_secret_kms_key_id       = aws_kms_key.database.arn',
    );

    // Nothing that could put the password into state survives.
    expect(content).not.toContain('random_password');
    expect(content).not.toContain('aws_secretsmanager_secret_version');
    expect(content).not.toContain('master_password ');

    expect(result.nextSteps).toEqual([]);
    expect(content).toMatchSnapshot();
  });

  it('should drop the rotation stack RDS-managed rotation replaces', async () => {
    tree.write(AURORA_FILE, AURORA_BEFORE);

    await migration(tree);
    const content = tree.read(AURORA_FILE, 'utf-8')!;

    expect(content).not.toContain('aws_cloudformation_stack');
    expect(content).not.toContain('credentials_rotation');
    expect(content).not.toContain('"rotation"');
    expect(content).not.toContain('enable_credential_rotation');
    // The rotation Lambda was its only consumer.
    expect(content).not.toContain('lambda_subnet_ids');
  });

  it('should read the secret ARN from the cluster', async () => {
    tree.write(AURORA_FILE, AURORA_BEFORE);

    await migration(tree);
    const content = tree.read(AURORA_FILE, 'utf-8')!;

    expect(content).toContain(
      'aws_rds_cluster.database.master_user_secret[0].secret_arn',
    );
    expect(content).toContain('aws_rds_cluster.database.master_username');
    // Secrets Manager encrypts the managed secret with the module's own CMK.
    expect(content).toContain('AllowSecretsManagerService');
    expect(content).toContain('AllowRDSService');
    // The writer endpoint the admin-credentialled handlers connect to.
    expect(content).toContain('output "writer_endpoint"');
    expect(content).toContain('output "reader_endpoint"');
  });

  it('should keep the cluster guarded and its data intact', async () => {
    tree.write(AURORA_FILE, AURORA_BEFORE);

    await migration(tree);
    const content = tree.read(AURORA_FILE, 'utf-8')!;

    // Switching credentials management must not touch anything identifying or
    // protecting the cluster - that is what keeps the apply in-place.
    expect(content).toContain('cluster_identifier');
    expect(content).toContain('local.cluster_name');
    expect(content).toContain('prevent_destroy = true');
    expect(content).toContain('var.deletion_protection');
  });

  it('should pass connection details to the handlers', async () => {
    tree.write(APP_MODULE_FILE, APP_MODULE_BEFORE);

    const result = await migration(tree);
    const content = tree.read(APP_MODULE_FILE, 'utf-8')!;

    // A managed secret holds only username and password, so both handlers need
    // the connection details passed explicitly.
    expect(content.match(/DATABASE_HOST/g)).toHaveLength(2);
    expect(content.match(/DATABASE_PORT/g)).toHaveLength(2);
    expect(content.match(/DATABASE_NAME/g)).toHaveLength(2);
    expect(content).toContain('module.aurora.writer_endpoint');

    expect(content).not.toContain('enable_credential_rotation');

    expect(result.nextSteps).toEqual([]);
    expect(content).toMatchSnapshot();
  });

  it('should do nothing when the workspace has no terraform aurora module', async () => {
    const result = await migration(tree);

    expect(result.nextSteps).toEqual([]);
    expect(tree.exists(AURORA_FILE)).toBe(false);
  });

  it('should skip and report a customised core module', async () => {
    const customised = `resource "aws_rds_cluster" "my_own_cluster" {
  cluster_identifier = "custom"
  master_password    = var.my_own_password
}
`;
    tree.write(AURORA_FILE, customised);

    const result = await migration(tree);

    expect(tree.read(AURORA_FILE, 'utf-8')).toBe(customised);
    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps[0]).toContain(AURORA_FILE);
    expect(result.nextSteps[0]).toContain('manage_master_user_password');
  });

  it('should skip and report a customised app module', async () => {
    const customised = `resource "aws_lambda_function" "my_own_handler" {
  environment {
    variables = {
      MY_OWN_SECRET = module.aurora.secret_arn
    }
  }
}
`;
    tree.write(APP_MODULE_FILE, customised);

    const result = await migration(tree);

    expect(tree.read(APP_MODULE_FILE, 'utf-8')).toBe(customised);
    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps[0]).toContain(APP_MODULE_FILE);
    expect(result.nextSteps[0]).toContain('DATABASE_HOST');
  });

  it('should be idempotent', async () => {
    tree.write(AURORA_FILE, AURORA_BEFORE);
    tree.write(APP_MODULE_FILE, APP_MODULE_BEFORE);

    await migration(tree);
    const afterFirst = {
      aurora: tree.read(AURORA_FILE, 'utf-8'),
      appModule: tree.read(APP_MODULE_FILE, 'utf-8'),
    };

    const result = await migration(tree);

    expect(tree.read(AURORA_FILE, 'utf-8')).toBe(afterFirst.aurora);
    expect(tree.read(APP_MODULE_FILE, 'utf-8')).toBe(afterFirst.appModule);
    expect(result.nextSteps).toEqual([]);

    // Exactly one of each addition, not a second appended copy.
    expect(
      afterFirst.aurora?.match(/manage_master_user_password/g),
    ).toHaveLength(1);
    expect(
      afterFirst.aurora?.match(/AllowSecretsManagerService/g),
    ).toHaveLength(1);
    expect(afterFirst.aurora?.match(/output "writer_endpoint"/g)).toHaveLength(
      1,
    );
  });
});
