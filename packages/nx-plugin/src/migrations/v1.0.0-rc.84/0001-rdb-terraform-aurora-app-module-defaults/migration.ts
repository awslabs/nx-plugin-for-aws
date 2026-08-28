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
  applyGritQL,
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
 * Align each vended per-database Terraform app module
 * (`app/dbs/<name>/<name>.tf`) with the core Aurora module it wraps.
 *
 * The app module is what a root configuration instantiates and it forwards its
 * own value down, so its default is the one that takes effect:
 *
 * - `enable_cloudwatch_logs` defaulted to `false` against the core module's
 *   `true`, so Aurora exported no engine logs and the cluster parameter group
 *   that configures them (`log_statement=ddl` on PostgreSQL,
 *   `server_audit_events=CONNECT,QUERY_DDL` on MySQL) was never created —
 *   the CDK construct enabled both.
 * - `enable_key_rotation` was never declared, leaving the core module's
 *   variable unreachable from a root configuration.
 *
 * These files are generated with `KeepExisting`, so an upgraded workspace keeps
 * the diverged defaults until this runs. Diverged files are left untouched and
 * reported via `nextSteps`.
 */

const TERRAFORM_DBS_APP_DIR = `${PACKAGES_DIR}/${SHARED_TERRAFORM_DIR}/src/app/dbs`;

const hcl = (pattern: string) => `language hcl\n${pattern}`;

const KEY_ROTATION_VARIABLE = [
  'variable "enable_key_rotation" {',
  '  description = "Whether to enable automatic key rotation on the KMS key used to encrypt the Aurora cluster and its credentials secret."',
  '  type        = bool',
  '  default     = true',
  '}',
].join('\n');

const divergedMessage = (filePath: string) =>
  `${filePath}: has diverged from the generated shape - left untouched. To export Aurora engine logs to CloudWatch as the CDK construct and the core Terraform module do, default \`enable_cloudwatch_logs\` to true here, and declare an \`enable_key_rotation\` variable (bool, default true) forwarded to the aurora module (see the ts#rdb generator's dbs app template).`;

const OLD_LOGS_DESCRIPTION =
  'Whether to export Aurora engine logs to CloudWatch. PostgreSQL also enables verbose statement logging.';
const NEW_LOGS_DESCRIPTION =
  'Whether to export Aurora engine logs to CloudWatch. PostgreSQL logs DDL statements only (log_statement=ddl); MySQL enables Advanced Auditing scoped to connections and DDL (server_audit_events=CONNECT,QUERY_DDL). Neither logs statement parameter values, to avoid leaking PII into log data.';

/**
 * Flip the app module's `enable_cloudwatch_logs` default to match the core
 * module, and replace the description that documented the old behaviour.
 *
 * Keyed on that description, which is the only thing distinguishing the vended
 * `default = false` from a user who deliberately turned log export off.
 */
const migrateCloudwatchLogsDefault = (tree: Tree, filePath: string) =>
  applyGritQL(
    tree,
    filePath,
    hcl(
      `\`variable "enable_cloudwatch_logs" { $props }\` where {` +
        ` $props <: contains \`description = "${OLD_LOGS_DESCRIPTION}"\` => \`description = "${NEW_LOGS_DESCRIPTION}"\`,` +
        ` $props <: contains \`default = false\` => \`default = true\`` +
        ` }`,
    ),
  );

/**
 * Declare `enable_key_rotation` and forward it to the core aurora module, so a
 * root configuration can reach the variable the core module already exposes.
 */
const migrateKeyRotationVariable = async (
  tree: Tree,
  filePath: string,
): Promise<void> => {
  if (
    await matchGritQL(
      tree,
      filePath,
      hcl('`variable "enable_key_rotation" { $_ }`'),
    )
  ) {
    return; // Already declared.
  }

  const declared = await insertViaGritQL(
    tree,
    filePath,
    hcl(
      `\`variable "enable_backup" { $props }\` => \`variable "enable_backup" {\n  $props\n}\n\n${GRIT_INSERT_PLACEHOLDER}\``,
    ),
    KEY_ROTATION_VARIABLE,
  );
  if (!declared) return;

  // Appended after the existing arguments so their alignment is preserved;
  // `terraform fmt` re-aligns the block.
  await applyGritQL(
    tree,
    filePath,
    hcl(
      `\`module "aurora" { $props }\` => \`module "aurora" {\n  $props\n\n  enable_key_rotation = var.enable_key_rotation\n}\``,
    ),
  );
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  if (!tree.exists(TERRAFORM_DBS_APP_DIR)) {
    return { nextSteps }; // This workspace has no Terraform database modules.
  }

  for (const dirName of tree.children(TERRAFORM_DBS_APP_DIR)) {
    const filePath = joinPathFragments(
      TERRAFORM_DBS_APP_DIR,
      dirName,
      `${dirName}.tf`,
    );
    if (!tree.exists(filePath)) {
      continue; // Not a database app module directory.
    }

    // Both edits hang off the shape the generator produces: the two variables
    // and the module call that forwards them.
    const recognised =
      (await matchGritQL(
        tree,
        filePath,
        hcl('`variable "enable_cloudwatch_logs" { $_ }`'),
      )) &&
      (await matchGritQL(
        tree,
        filePath,
        hcl('`variable "enable_backup" { $_ }`'),
      )) &&
      (await matchGritQL(
        tree,
        filePath,
        hcl(
          '`module "aurora" { $props }` where { $props <: contains `enable_cloudwatch_logs = var.enable_cloudwatch_logs` }',
        ),
      ));

    if (!recognised) {
      nextSteps.push(divergedMessage(filePath));
      continue;
    }

    await migrateCloudwatchLogsDefault(tree, filePath);
    await migrateKeyRotationVariable(tree, filePath);
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
