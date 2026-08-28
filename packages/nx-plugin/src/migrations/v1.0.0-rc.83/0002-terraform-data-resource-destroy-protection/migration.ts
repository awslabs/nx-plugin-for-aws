/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { MigrationReturnObject, Tree } from '@nx/devkit';
import { applyGritQL, matchGritQL } from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import {
  PACKAGES_DIR,
  SHARED_TERRAFORM_DIR,
} from '../../../utils/shared-constructs-constants.js';

/**
 * Bring existing workspaces up to the destroy protection the generators now
 * vend on the data-bearing Terraform resources:
 *
 * - The DynamoDB table and the Aurora cluster gain
 *   `lifecycle { prevent_destroy = true }`. This is a second, independent layer
 *   on top of the service-side `deletion_protection_enabled` /
 *   `deletion_protection` flags, matching the two guards the CDK constructs
 *   already have (`deletionProtection` plus `RemovalPolicy.RETAIN`). Without it,
 *   clearing the service-side flag destroys the data in the same apply.
 *   `prevent_destroy` cannot reference a variable, so it is vended as a literal
 *   and removed to tear down.
 * - Their KMS keys pin `deletion_window_in_days = 30`, the provider maximum and
 *   the CDK default. Restoring either resource from a point-in-time backup or
 *   snapshot requires its key, so the window in which a scheduled key deletion
 *   can still be cancelled matters as much as the backup itself.
 *
 * These files are generated with `KeepExisting`, so without this an upgraded
 * workspace keeps the weaker single-layer protection. Diverged files are left
 * untouched and reported via `nextSteps`.
 */

const TERRAFORM_DYNAMODB_FILE = `${PACKAGES_DIR}/${SHARED_TERRAFORM_DIR}/src/core/dynamodb/dynamodb.tf`;
const TERRAFORM_AURORA_FILE = `${PACKAGES_DIR}/${SHARED_TERRAFORM_DIR}/src/core/rdb/aurora/aurora.tf`;

const hcl = (pattern: string) => `language hcl\n${pattern}`;

const divergedMessage = (filePath: string, resource: string) =>
  `${filePath}: has diverged from the generated shape - left untouched. To protect the ${resource} from being destroyed when the service-side deletion protection flag is cleared, add \`lifecycle { prevent_destroy = true }\` to it, and set \`deletion_window_in_days = 30\` on its KMS key.`;

/**
 * Add the maximum KMS pending window to a key that omits it, so a scheduled
 * deletion stays cancellable for as long as the provider allows.
 */
const migrateKmsKey = async (
  tree: Tree,
  filePath: string,
  keyLabel: string,
): Promise<void> => {
  const keyBlock = hcl(`\`resource "aws_kms_key" "${keyLabel}" { $props }\``);

  // Already pinned - nothing to do.
  if (
    await matchGritQL(
      tree,
      filePath,
      hcl(
        `\`resource "aws_kms_key" "${keyLabel}" { $props }\` where { $props <: contains \`deletion_window_in_days = $_\` }`,
      ),
    )
  ) {
    return;
  }

  if (!(await matchGritQL(tree, filePath, keyBlock))) {
    return; // Reported by the caller, which matches the data resource too.
  }

  await applyGritQL(
    tree,
    filePath,
    hcl(
      `\`resource "aws_kms_key" "${keyLabel}" { $props }\` where { $props <: contains \`enable_key_rotation = $rotation\` => \`enable_key_rotation = $rotation\n\n  deletion_window_in_days = 30\` }`,
    ),
  );
};

/**
 * Add `lifecycle { prevent_destroy = true }` to a data-bearing resource.
 */
const migrateDataResource = async (
  tree: Tree,
  filePath: string,
  resourceType: string,
  resourceLabel: string,
  nextSteps: string[],
  description: string,
): Promise<boolean> => {
  const resourceBlock = hcl(
    `\`resource "${resourceType}" "${resourceLabel}" { $props }\``,
  );

  if (!(await matchGritQL(tree, filePath, resourceBlock))) {
    nextSteps.push(divergedMessage(filePath, description));
    return false;
  }

  // Already guarded - keep the user's block, whatever it is set to.
  if (
    await matchGritQL(
      tree,
      filePath,
      hcl(
        `\`resource "${resourceType}" "${resourceLabel}" { $props }\` where { $props <: contains \`prevent_destroy = $_\` }`,
      ),
    )
  ) {
    return true;
  }

  await applyGritQL(
    tree,
    filePath,
    hcl(
      `\`resource "${resourceType}" "${resourceLabel}" { $props }\` => \`resource "${resourceType}" "${resourceLabel}" {\n  $props\n\n  lifecycle {\n    prevent_destroy = true\n  }\n}\``,
    ),
  );

  return true;
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  if (tree.exists(TERRAFORM_DYNAMODB_FILE)) {
    if (
      await migrateDataResource(
        tree,
        TERRAFORM_DYNAMODB_FILE,
        'aws_dynamodb_table',
        'table',
        nextSteps,
        'DynamoDB table',
      )
    ) {
      await migrateKmsKey(tree, TERRAFORM_DYNAMODB_FILE, 'table');
    }
  }

  if (tree.exists(TERRAFORM_AURORA_FILE)) {
    if (
      await migrateDataResource(
        tree,
        TERRAFORM_AURORA_FILE,
        'aws_rds_cluster',
        'database',
        nextSteps,
        'Aurora cluster',
      )
    ) {
      await migrateKmsKey(tree, TERRAFORM_AURORA_FILE, 'database');
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
