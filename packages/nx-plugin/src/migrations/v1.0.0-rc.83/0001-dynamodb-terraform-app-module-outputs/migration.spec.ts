/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const APP_MODULE_FILE =
  'packages/common/terraform/src/app/dynamodb/my-table/my-table.tf';
const APP_MODULE_FILE_2 =
  'packages/common/terraform/src/app/dynamodb/other-table/other-table.tf';

/** The vended per-table Terraform app module, before it had any outputs. */
const oldAppModule = (tableName: string) => `terraform {
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

resource "random_string" "suffix" {
  length  = 8
  special = false
  upper   = false
}

locals {
  dynamodb_config = jsondecode(file("\${path.module}/../../../../../../../packages/${tableName}/config.json"))
  global_secondary_indexes = [for gsi in local.dynamodb_config.tableConfig.globalSecondaryIndexes : {
    name            = gsi.indexName
    hash_key        = gsi.partitionKey
    range_key       = try(gsi.sortKey, null)
    projection_type = "ALL"
  }]
}

module "dynamodb_table" {
  source                   = "../../../core/dynamodb"
  name                     = "${tableName}-\${random_string.suffix.result}"
  billing_mode             = var.billing_mode
  global_secondary_indexes = local.global_secondary_indexes
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

describe('dynamodb-terraform-app-module-outputs migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('does nothing when no vended dynamodb modules exist', async () => {
    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
  });

  it('re-exports the table and key attributes from the app module', async () => {
    tree.write(APP_MODULE_FILE, oldAppModule('my-table'));

    const result = await migration(tree);
    const contents = tree.read(APP_MODULE_FILE, 'utf-8')!;

    expect(contents).toContain('output "table_name"');
    expect(contents).toContain(
      'value       = module.dynamodb_table.table_name',
    );
    expect(contents).toContain('output "table_arn"');
    expect(contents).toContain('value       = module.dynamodb_table.table_arn');
    expect(contents).toContain('output "kms_key_arn"');
    expect(contents).toContain(
      'value       = module.dynamodb_table.kms_key_arn',
    );

    // The existing configuration is preserved
    expect(contents).toContain('module "add_to_runtime_config"');
    expect(contents).toContain('module "dynamodb_table"');
    expect(result.nextSteps).toEqual([]);
  });

  it('migrates every app module directory found', async () => {
    tree.write(APP_MODULE_FILE, oldAppModule('my-table'));
    tree.write(APP_MODULE_FILE_2, oldAppModule('other-table'));

    await migration(tree);

    for (const file of [APP_MODULE_FILE, APP_MODULE_FILE_2]) {
      expect(tree.read(file, 'utf-8')!).toContain('output "table_arn"');
    }
  });

  it('is idempotent', async () => {
    tree.write(APP_MODULE_FILE, oldAppModule('my-table'));

    await migration(tree);
    const afterFirst = tree.read(APP_MODULE_FILE, 'utf-8');

    await migration(tree);

    expect(tree.read(APP_MODULE_FILE, 'utf-8')).toEqual(afterFirst);
  });

  it('leaves an already-migrated module untouched', async () => {
    tree.write(APP_MODULE_FILE, oldAppModule('my-table'));
    await migration(tree);
    const migrated = tree.read(APP_MODULE_FILE, 'utf-8')!;

    tree.write(APP_MODULE_FILE, migrated);
    const result = await migration(tree);

    expect(tree.read(APP_MODULE_FILE, 'utf-8')).toEqual(migrated);
    expect(result.nextSteps).toEqual([]);
  });

  it('skips and reports a diverged app module', async () => {
    tree.write(
      APP_MODULE_FILE,
      'module "something_else" {\n  source = "../../../core/dynamodb"\n}\n',
    );

    const result = await migration(tree);

    expect(tree.read(APP_MODULE_FILE, 'utf-8')).not.toContain('output "');
    expect(result.nextSteps).toEqual([
      `${APP_MODULE_FILE}: has diverged from the generated shape - left untouched. To reference the table from your root Terraform configuration, add table_name, table_arn and kms_key_arn outputs here forwarding the equivalent module.dynamodb_table attributes (see the ts#dynamodb generator's dynamodb app template).`,
    ]);
  });
});
