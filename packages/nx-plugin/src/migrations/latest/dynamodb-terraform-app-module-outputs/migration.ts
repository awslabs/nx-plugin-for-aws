/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
} from '@nx/devkit';
import {
  GRIT_INSERT_PLACEHOLDER,
  insertViaGritQL,
  matchGritQL,
} from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import {
  PACKAGES_DIR,
  SHARED_TERRAFORM_DIR,
} from '../../../utils/shared-constructs-constants.js';

/**
 * Re-export the core dynamodb module's `table_name`, `table_arn` and
 * `kms_key_arn` from each vended per-table Terraform app module
 * (`app/dynamodb/<name>/<name>.tf`).
 *
 * The app module is what a root configuration instantiates, so without these
 * outputs a root module cannot reference the table or its encryption key at
 * all — for example to grant a consumer access to it.
 *
 * These files are generated with `KeepExisting`, so an upgraded workspace keeps
 * a module with no outputs until this runs. Diverged files are left untouched
 * and reported via `nextSteps`.
 */

const TERRAFORM_DYNAMODB_APP_DIR = `${PACKAGES_DIR}/${SHARED_TERRAFORM_DIR}/src/app/dynamodb`;

const divergedMessage = (filePath: string) =>
  `${filePath}: has diverged from the generated shape - left untouched. To reference the table from your root Terraform configuration, add table_name, table_arn and kms_key_arn outputs here forwarding the equivalent module.dynamodb_table attributes (see the ts#dynamodb generator's dynamodb app template).`;

const hcl = (pattern: string) => `language hcl\n${pattern}`;

const OUTPUTS_TEXT = [
  'output "table_name" {',
  '  description = "Name of the DynamoDB table"',
  '  value       = module.dynamodb_table.table_name',
  '}',
  '',
  'output "table_arn" {',
  '  description = "ARN of the DynamoDB table, for use in IAM policies granting access to the table. Suffix with /index/* to cover its global secondary indexes."',
  '  value       = module.dynamodb_table.table_arn',
  '}',
  '',
  'output "kms_key_arn" {',
  '  description = "ARN of the KMS key used to encrypt the DynamoDB table, for use in IAM policies granting access to the table. Null when using the AWS owned key (encryption = DEFAULT)."',
  '  value       = module.dynamodb_table.kms_key_arn',
  '}',
].join('\n');

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  if (!tree.exists(TERRAFORM_DYNAMODB_APP_DIR)) {
    return { nextSteps }; // This workspace has no Terraform dynamodb modules.
  }

  for (const dirName of tree.children(TERRAFORM_DYNAMODB_APP_DIR)) {
    const filePath = joinPathFragments(
      TERRAFORM_DYNAMODB_APP_DIR,
      dirName,
      `${dirName}.tf`,
    );
    if (!tree.exists(filePath)) {
      continue; // Not a dynamodb app module directory.
    }

    if (await matchGritQL(tree, filePath, hcl('`output "table_arn" { $_ }`'))) {
      continue; // Already migrated.
    }

    const RUNTIME_CONFIG_MODULE_BLOCK = hcl(
      '`module "add_to_runtime_config" { $_ }`',
    );
    if (!(await matchGritQL(tree, filePath, RUNTIME_CONFIG_MODULE_BLOCK))) {
      nextSteps.push(divergedMessage(filePath));
      continue;
    }

    // Appended after the runtime config module call, which the template ends
    // with, matching where the generator now writes the outputs.
    await insertViaGritQL(
      tree,
      filePath,
      hcl(
        `\`module "add_to_runtime_config" { $body }\` => \`module "add_to_runtime_config" {\n  $body\n}\n\n${GRIT_INSERT_PLACEHOLDER}\``,
      ),
      OUTPUTS_TEXT,
    );
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
