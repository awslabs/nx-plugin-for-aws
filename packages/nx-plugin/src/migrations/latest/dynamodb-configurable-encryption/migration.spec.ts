/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const CDK_DYNAMODB_FILE = 'packages/common/constructs/src/core/dynamodb.ts';
const TF_DYNAMODB_FILE =
  'packages/common/terraform/src/core/dynamodb/dynamodb.tf';
const TF_APP_MODULE_FILE =
  'packages/common/terraform/src/app/dynamodb/my-table/my-table.tf';
const TF_APP_MODULE_FILE_2 =
  'packages/common/terraform/src/app/dynamodb/other-table/other-table.tf';

/** The vended DynamoDBTable CDK construct, before encryption/encryptionKey. */
const OLD_CDK_DYNAMODB = `import { Construct } from 'constructs';
import {
  AttributeType,
  BillingMode,
  Table,
  TableEncryption,
  TableProps,
} from 'aws-cdk-lib/aws-dynamodb';
import { RemovalPolicy } from 'aws-cdk-lib';
import { Grant, IGrantable } from 'aws-cdk-lib/aws-iam';
import { Key } from 'aws-cdk-lib/aws-kms';
import { RuntimeConfig } from './runtime-config.js';

type _DynamoDBTableProps = Omit<TableProps, 'tableName' | 'partitionKey' | 'sortKey' | 'encryption' | 'encryptionKey'>;

export interface DynamoDBTableProps extends _DynamoDBTableProps {
  /**
   * The DynamoDB table name. If omitted, CDK auto-generates a unique name
   * from the stack name and construct path.
   */
  readonly tableName?: string;

  /**
   * RuntimeConfig key used under the \`dynamodb\` namespace.
   */
  readonly runtimeConfigKey: string;

  /**
   * Whether to enable automatic key rotation on the KMS key used to encrypt the table.
   *
   * @default true
   */
  readonly enableKeyRotation?: boolean;
}

export abstract class DynamoDBTable extends Construct {
  public readonly table: Table;

  constructor(
    scope: Construct,
    id: string,
    {
      tableName,
      runtimeConfigKey,
      billingMode = BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification = { pointInTimeRecoveryEnabled: true },
      deletionProtection = true,
      removalPolicy = RemovalPolicy.RETAIN,
      enableKeyRotation = true,
      ...rest
    }: DynamoDBTableProps,
  ) {
    super(scope, id);

    const key = new Key(this, 'EncryptionKey', { enableKeyRotation });

    this.table = new Table(this, runtimeConfigKey, {
      ...rest,
      ...(tableName !== undefined && { tableName }),
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode,
      pointInTimeRecoverySpecification,
      deletionProtection,
      encryptionKey: key,
      encryption: TableEncryption.CUSTOMER_MANAGED,
      removalPolicy,
    });

    const rc = RuntimeConfig.ensure(this);
    rc.set('dynamodb', runtimeConfigKey, { tableName: this.table.tableName });
  }

  public grantReadData(grantee: IGrantable): Grant {
    return this.table.grantReadData(grantee);
  }

  public grantWriteData(grantee: IGrantable): Grant {
    return this.table.grantWriteData(grantee);
  }

  public grantReadWriteData(grantee: IGrantable): Grant {
    return this.table.grantReadWriteData(grantee);
  }

  public grantFullAccess(grantee: IGrantable): Grant {
    return this.table.grantFullAccess(grantee);
  }

  public grantStreamRead(grantee: IGrantable): Grant {
    return this.table.grantStreamRead(grantee);
  }

  public grantTableListStreams(grantee: IGrantable): Grant {
    return this.table.grantTableListStreams(grantee);
  }

  public grant(grantee: IGrantable, ...actions: string[]): Grant {
    return this.table.grant(grantee, ...actions);
  }

  public grantStream(grantee: IGrantable, ...actions: string[]): Grant {
    return this.table.grantStream(grantee, ...actions);
  }
}
`;

/** The vended Terraform dynamodb core module, before encryption/kms_key_arn. */
const OLD_TF_DYNAMODB = `terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "5.100.0"
    }
  }
}

variable "name" {
  description = "Name for the DynamoDB table."
  type        = string
}

variable "billing_mode" {
  description = "Controls how you are charged for read and write throughput."
  type        = string
  default     = "PAY_PER_REQUEST"
}

variable "point_in_time_recovery_enabled" {
  description = "Whether to enable point-in-time recovery for the table."
  type        = bool
  default     = true
}

variable "deletion_protection_enabled" {
  description = "Whether to enable deletion protection on the table."
  type        = bool
  default     = true
}

variable "enable_key_rotation" {
  description = "Whether to enable automatic key rotation on the KMS key used to encrypt the table."
  type        = bool
  default     = true
}

variable "global_secondary_indexes" {
  description = "Global secondary indexes to create on the table. All key attributes must be of type string."
  type = list(object({
    name            = string
    hash_key        = string
    range_key       = string
    projection_type = string
  }))
  default = []
}

locals {
  gsi_attribute_names = distinct(flatten([
    for gsi in var.global_secondary_indexes : [gsi.hash_key, gsi.range_key]
  ]))
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

resource "aws_kms_key" "table" {
  description         = "KMS key for DynamoDB table \${var.name}"
  enable_key_rotation = var.enable_key_rotation

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "EnableRootAccess"
        Effect = "Allow"
        Principal = {
          AWS = "arn:\${data.aws_partition.current.partition}:iam::\${data.aws_caller_identity.current.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "AllowDynamoDBService"
        Effect = "Allow"
        Principal = {
          Service = "dynamodb.amazonaws.com"
        }
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:DescribeKey",
          "kms:CreateGrant"
        ]
        Resource = "*"
      }
    ]
  })
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

  attribute {
    name = "sk"
    type = "S"
  }

  dynamic "attribute" {
    for_each = toset(local.gsi_attribute_names)
    content {
      name = attribute.value
      type = "S"
    }
  }

  dynamic "global_secondary_index" {
    for_each = var.global_secondary_indexes
    content {
      name            = global_secondary_index.value.name
      hash_key        = global_secondary_index.value.hash_key
      range_key       = global_secondary_index.value.range_key
      projection_type = global_secondary_index.value.projection_type
    }
  }

  point_in_time_recovery {
    enabled = var.point_in_time_recovery_enabled
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.table.arn
  }
}

output "table_name" {
  description = "Name of the DynamoDB table."
  value       = aws_dynamodb_table.table.name
}

output "table_arn" {
  description = "ARN of the DynamoDB table."
  value       = aws_dynamodb_table.table.arn
}

output "kms_key_arn" {
  description = "ARN of the KMS key used to encrypt the DynamoDB table."
  value       = aws_kms_key.table.arn
}
`;

/** The vended per-table Terraform app module, before encryption/kms_key_arn. */
const oldTfAppModule = (tableName: string) => `terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "5.100.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "3.6.3"
    }
  }
}

variable "billing_mode" {
  description = "Controls how you are charged for read and write throughput."
  type        = string
  default     = "PAY_PER_REQUEST"
}

variable "point_in_time_recovery_enabled" {
  description = "Whether to enable point-in-time recovery for the table."
  type        = bool
  default     = true
}

variable "deletion_protection_enabled" {
  description = "Whether to enable deletion protection on the table."
  type        = bool
  default     = true
}

variable "enable_key_rotation" {
  description = "Whether to enable automatic key rotation on the KMS key used to encrypt the table."
  type        = bool
  default     = true
}

resource "random_string" "suffix" {
  length  = 8
  special = false
  upper   = false
}

locals {
  dynamodb_config = jsondecode(file("\${path.module}/../../../../../../../apps/${tableName}/config.json"))
  global_secondary_indexes = [for gsi in local.dynamodb_config.tableConfig.globalSecondaryIndexes : {
    name            = gsi.indexName
    hash_key        = gsi.partitionKey
    range_key       = try(gsi.sortKey, null)
    projection_type = "ALL"
  }]
}

module "dynamodb_table" {
  source                         = "../../../core/dynamodb"
  name                           = "${tableName}-\${random_string.suffix.result}"
  billing_mode                   = var.billing_mode
  point_in_time_recovery_enabled = var.point_in_time_recovery_enabled
  deletion_protection_enabled    = var.deletion_protection_enabled
  enable_key_rotation            = var.enable_key_rotation
  global_secondary_indexes       = local.global_secondary_indexes
}

module "add_to_runtime_config" {
  source = "../../../core/runtime-config/entry"

  namespace = "dynamodb"
  key       = local.dynamodb_config.runtimeConfigKey
  value = {
    tableName = module.dynamodb_table.table_name
  }
}
`;

describe('dynamodb-configurable-encryption migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const seedCdk = () => tree.write(CDK_DYNAMODB_FILE, OLD_CDK_DYNAMODB);
  const seedTfCore = () => tree.write(TF_DYNAMODB_FILE, OLD_TF_DYNAMODB);
  const seedTfApp = () =>
    tree.write(TF_APP_MODULE_FILE, oldTfAppModule('my-table'));

  it('does nothing when no vended dynamodb files exist', async () => {
    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
  });

  it('surfaces encryption and encryptionKey on the CDK construct', async () => {
    seedCdk();
    const result = await migration(tree);
    const contents = tree.read(CDK_DYNAMODB_FILE, 'utf-8')!;

    expect(contents).toContain(
      "import { Key, IKey } from 'aws-cdk-lib/aws-kms';",
    );
    expect(contents).toContain('readonly encryption?: TableEncryption;');
    expect(contents).toContain('readonly encryptionKey?: IKey;');
    expect(contents).toContain(
      'encryption = TableEncryption.CUSTOMER_MANAGED,',
    );
    expect(contents).toContain('encryptionKey,');
    expect(contents).toContain('const key: IKey | undefined =');
    expect(contents).toContain('encryptionKey ??');
    expect(contents).toContain(
      "new Key(this, 'EncryptionKey', { enableKeyRotation })",
    );
    expect(contents).toContain('encryption,');
    expect(contents).not.toContain(
      'encryption: TableEncryption.CUSTOMER_MANAGED,',
    );
    expect(contents).toContain(
      'Only applies when `encryption` is `TableEncryption.CUSTOMER_MANAGED` and no',
    );
    expect(result.nextSteps).toEqual([]);
    expect(contents).toMatchSnapshot();
  });

  it('surfaces encryption and kms_key_arn on the terraform core module', async () => {
    seedTfCore();
    const result = await migration(tree);
    const contents = tree.read(TF_DYNAMODB_FILE, 'utf-8')!;

    expect(contents).toContain('variable "encryption"');
    expect(contents).toContain('variable "kms_key_arn"');
    expect(contents).toContain('variable "create_kms_key"');
    expect(contents).toContain(
      'contains(["CUSTOMER_MANAGED", "AWS_MANAGED", "DEFAULT"], var.encryption)',
    );
    expect(contents).toContain(
      'create_table_key = var.encryption == "CUSTOMER_MANAGED" && var.create_kms_key',
    );
    expect(contents).toContain('table_kms_key_arn = (');
    expect(contents).toContain(
      'var.encryption == "AWS_MANAGED" ? "arn:${data.aws_partition.current.partition}:kms:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:alias/aws/dynamodb" :',
    );
    expect(contents).toContain('data "aws_region" "current" {}');
    expect(contents).toContain('count = local.create_table_key ? 1 : 0');
    expect(contents).toContain('enabled = var.encryption != "DEFAULT"');
    expect(contents).toContain(
      '#checkov:skip=CKV_AWS_119:Encryption is configurable via var.encryption; checkov cannot resolve the conditional server_side_encryption.enabled expression',
    );
    expect(contents).toContain('kms_key_arn = local.table_kms_key_arn');
    expect(contents).not.toContain('kms_key_arn = aws_kms_key.table.arn');
    expect(contents).not.toContain('enabled     = true');
    expect(contents).toContain('value = local.table_kms_key_arn');
    expect(contents).toContain(
      'description = "ARN of the KMS key used to encrypt the DynamoDB table, or null when using the AWS owned key (encryption = DEFAULT)."',
    );
    expect(result.nextSteps).toEqual([]);
    expect(contents).toMatchSnapshot();
  });

  it('surfaces encryption and kms_key_arn as pass-through variables on the terraform app module', async () => {
    seedTfApp();
    const result = await migration(tree);
    const contents = tree.read(TF_APP_MODULE_FILE, 'utf-8')!;

    expect(contents).toContain('variable "encryption"');
    expect(contents).toContain('variable "kms_key_arn"');
    expect(contents).toContain('variable "create_kms_key"');
    expect(contents).toContain(
      'contains(["CUSTOMER_MANAGED", "AWS_MANAGED", "DEFAULT"], var.encryption)',
    );
    expect(contents).toContain('encryption');
    expect(contents).toContain('= var.encryption');
    expect(contents).toContain('kms_key_arn');
    expect(contents).toContain('= var.kms_key_arn');
    expect(contents).toContain('= var.create_kms_key');
    expect(result.nextSteps).toEqual([]);
    expect(contents).toMatchSnapshot();
  });

  it('migrates every terraform app module directory found', async () => {
    seedTfApp();
    tree.write(TF_APP_MODULE_FILE_2, oldTfAppModule('other-table'));

    const result = await migration(tree);

    expect(tree.read(TF_APP_MODULE_FILE, 'utf-8')!).toContain(
      'variable "encryption"',
    );
    expect(tree.read(TF_APP_MODULE_FILE_2, 'utf-8')!).toContain(
      'variable "encryption"',
    );
    expect(result.nextSteps).toEqual([]);
  });

  it('is idempotent across cdk, terraform core and terraform app files', async () => {
    seedCdk();
    seedTfCore();
    seedTfApp();

    await migration(tree);
    const cdkAfterFirst = tree.read(CDK_DYNAMODB_FILE, 'utf-8');
    const tfCoreAfterFirst = tree.read(TF_DYNAMODB_FILE, 'utf-8');
    const tfAppAfterFirst = tree.read(TF_APP_MODULE_FILE, 'utf-8');

    const secondRun = await migration(tree);

    expect(tree.read(CDK_DYNAMODB_FILE, 'utf-8')).toEqual(cdkAfterFirst);
    expect(tree.read(TF_DYNAMODB_FILE, 'utf-8')).toEqual(tfCoreAfterFirst);
    expect(tree.read(TF_APP_MODULE_FILE, 'utf-8')).toEqual(tfAppAfterFirst);
    expect(secondRun.nextSteps).toEqual([]);
  });

  it('skips and reports a diverged CDK construct', async () => {
    // Diverged: the user renamed the key variable, so the literal
    // key-creation anchor this migration matches on is no longer present.
    tree.write(
      CDK_DYNAMODB_FILE,
      OLD_CDK_DYNAMODB.replace(
        "const key = new Key(this, 'EncryptionKey', { enableKeyRotation });",
        "const encryptionKey = new Key(this, 'EncryptionKey', { enableKeyRotation });",
      ),
    );

    const result = await migration(tree);
    const contents = tree.read(CDK_DYNAMODB_FILE, 'utf-8')!;

    expect(contents).toContain(
      "const encryptionKey = new Key(this, 'EncryptionKey', { enableKeyRotation });",
    );
    expect(contents).not.toContain('readonly encryption?: TableEncryption');
    expect(result.nextSteps).toEqual([
      `${CDK_DYNAMODB_FILE}: has diverged from the generated shape - left untouched. To pick up the encryption and encryptionKey props, manually port them from the vended core/dynamodb.ts template (see the ts#dynamodb generator's DynamoDBTable construct).`,
    ]);
  });

  it('skips and reports a diverged terraform core module', async () => {
    // Diverged: the user customised the enable_key_rotation variable's
    // description, so the literal variable-block anchor no longer matches.
    tree.write(
      TF_DYNAMODB_FILE,
      OLD_TF_DYNAMODB.replace(
        'description = "Whether to enable automatic key rotation on the KMS key used to encrypt the table."',
        'description = "Custom description added by the user."',
      ),
    );

    const result = await migration(tree);
    const contents = tree.read(TF_DYNAMODB_FILE, 'utf-8')!;

    expect(contents).toContain('Custom description added by the user.');
    expect(contents).not.toContain('variable "encryption"');
    expect(result.nextSteps).toEqual([
      `${TF_DYNAMODB_FILE}: has diverged from the generated shape - left untouched. To pick up the encryption and kms_key_arn variables, manually port them from the vended dynamodb.tf template (see the ts#dynamodb generator's dynamodb module).`,
    ]);
  });

  it('skips and reports a diverged terraform app module', async () => {
    // Diverged: the user customised the enable_key_rotation variable's
    // description, so the literal variable-block anchor no longer matches.
    tree.write(
      TF_APP_MODULE_FILE,
      oldTfAppModule('my-table').replace(
        'description = "Whether to enable automatic key rotation on the KMS key used to encrypt the table."',
        'description = "Custom description added by the user."',
      ),
    );

    const result = await migration(tree);
    const contents = tree.read(TF_APP_MODULE_FILE, 'utf-8')!;

    expect(contents).toContain('Custom description added by the user.');
    expect(contents).not.toContain('variable "encryption"');
    expect(result.nextSteps).toEqual([
      `${TF_APP_MODULE_FILE}: has diverged from the generated shape - left untouched. To make encryption and kms_key_arn configurable from your root Terraform configuration, add pass-through variables here and forward them to the dynamodb_table module call (see the ts#dynamodb generator's dynamodb app template).`,
    ]);
  });

  it('does not touch an already-migrated CDK construct', async () => {
    seedCdk();
    await migration(tree);
    const migrated = tree.read(CDK_DYNAMODB_FILE, 'utf-8');

    const result = await migration(tree);

    expect(tree.read(CDK_DYNAMODB_FILE, 'utf-8')).toEqual(migrated);
    expect(result.nextSteps).toEqual([]);
  });
});
