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
  addDestructuredImport,
  applyGritQL,
  GRIT_INSERT_PLACEHOLDER,
  insertViaGritQL,
  matchGritQL,
} from '../../../utils/ast';
import { formatFilesInSubtree } from '../../../utils/format';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../../../utils/shared-constructs-constants';

/**
 * Bring existing workspaces up to the generators' current DynamoDBTable
 * configurability:
 *
 * - The vended `DynamoDBTable` CDK construct gains `encryption` and
 *   `encryptionKey` props. The KMS key is only created when `encryption` is
 *   `TableEncryption.CUSTOMER_MANAGED` and no `encryptionKey` is supplied.
 *   `enableKeyRotation` (already present) only applies to that auto-created
 *   key.
 * - The generated per-table CDK app construct already forwards an optional
 *   `props` parameter through to `DynamoDBTable`, so no change is needed
 *   there.
 * - The vended Terraform dynamodb core module gains the equivalent
 *   `encryption` and `kms_key_arn` variables (`encryption` also accepts
 *   `DEFAULT`, the AWS owned key, which CDK already supports for free via
 *   `TableEncryption.DEFAULT`), with the KMS key made conditional via
 *   `count` and `server_side_encryption.enabled` tied to `encryption`.
 * - The vended Terraform per-table app module (`app/dynamodb/<name>/<name>.tf`)
 *   gains pass-through `encryption` and `kms_key_arn` variables forwarded to
 *   the core module call, matching its existing `enable_key_rotation`
 *   pass-through.
 *
 * These files are generated with `KeepExisting`, so without this an upgraded
 * workspace has generators that support this configuration but vended files
 * that don't. Diverged files are left untouched and reported via `nextSteps`.
 */

const CDK_DYNAMODB_FILE = `${PACKAGES_DIR}/${SHARED_CONSTRUCTS_DIR}/src/core/dynamodb.ts`;
const TERRAFORM_DYNAMODB_FILE = `${PACKAGES_DIR}/${SHARED_TERRAFORM_DIR}/src/core/dynamodb/dynamodb.tf`;
const TERRAFORM_DYNAMODB_APP_DIR = `${PACKAGES_DIR}/${SHARED_TERRAFORM_DIR}/src/app/dynamodb`;

const CDK_DIVERGED_MESSAGE = `${CDK_DYNAMODB_FILE}: has diverged from the generated shape - left untouched. To pick up the encryption and encryptionKey props, manually port them from the vended core/dynamodb.ts template (see the ts#dynamodb generator's DynamoDBTable construct).`;

const TERRAFORM_DIVERGED_MESSAGE = `${TERRAFORM_DYNAMODB_FILE}: has diverged from the generated shape - left untouched. To pick up the encryption and kms_key_arn variables, manually port them from the vended dynamodb.tf template (see the ts#dynamodb generator's dynamodb module).`;

const terraformAppDivergedMessage = (filePath: string) =>
  `${filePath}: has diverged from the generated shape - left untouched. To make encryption and kms_key_arn configurable from your root Terraform configuration, add pass-through variables here and forward them to the dynamodb_table module call (see the ts#dynamodb generator's dynamodb app template).`;

/**
 * Surface encryption/encryptionKey on the vended DynamoDBTable CDK
 * construct.
 */
const migrateCdkConstruct = async (
  tree: Tree,
  nextSteps: string[],
): Promise<void> => {
  if (!tree.exists(CDK_DYNAMODB_FILE)) {
    return; // This workspace has no CDK DynamoDBTable construct.
  }

  if (
    await matchGritQL(
      tree,
      CDK_DYNAMODB_FILE,
      '`readonly encryption?: TableEncryption`',
    )
  ) {
    return; // Already migrated.
  }

  const ENABLE_KEY_ROTATION_FIELD = '`readonly enableKeyRotation?: boolean`';
  // Matched as a literal so the new fields can be inserted *before* it (see
  // below) — GritQL doesn't include a leading comment in the span it matches
  // for the field itself, so anchoring on the field would strand this
  // comment above the newly-inserted fields instead of above the field it
  // actually documents.
  const ENABLE_KEY_ROTATION_COMMENT = `\`/**
   * Whether to enable automatic key rotation on the KMS key used to encrypt the table.
   *
   * @default true
   */\``;
  const DESTRUCTURE_OLD = `\`{
      tableName,
      runtimeConfigKey,
      billingMode = BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification = { pointInTimeRecoveryEnabled: true },
      deletionProtection = true,
      removalPolicy = RemovalPolicy.RETAIN,
      enableKeyRotation = true,
      ...rest
    }: DynamoDBTableProps\``;
  const KEY_CREATION_OLD =
    "`const key = new Key(this, 'EncryptionKey', { enableKeyRotation });`";
  const TABLE_ENCRYPTION_OLD = '`encryption: TableEncryption.CUSTOMER_MANAGED`';

  const anchors = [
    ENABLE_KEY_ROTATION_FIELD,
    ENABLE_KEY_ROTATION_COMMENT,
    DESTRUCTURE_OLD,
    KEY_CREATION_OLD,
    TABLE_ENCRYPTION_OLD,
  ];

  const allPresent = (
    await Promise.all(
      anchors.map((pattern) => matchGritQL(tree, CDK_DYNAMODB_FILE, pattern)),
    )
  ).every(Boolean);

  if (!allPresent) {
    nextSteps.push(CDK_DIVERGED_MESSAGE);
    return;
  }

  await addDestructuredImport(
    tree,
    CDK_DYNAMODB_FILE,
    ['IKey'],
    'aws-cdk-lib/aws-kms',
  );

  // Inserted before the enableKeyRotation field's own leading comment (rather
  // than before the bare field) so that comment stays directly above the
  // field it documents, instead of being stranded above the new fields.
  await insertViaGritQL(
    tree,
    CDK_DYNAMODB_FILE,
    `${ENABLE_KEY_ROTATION_COMMENT} as $comment => \`${GRIT_INSERT_PLACEHOLDER}
  $comment\``,
    `/**
   * Server-side encryption for the table.
   *
   * @default TableEncryption.CUSTOMER_MANAGED
   */
  readonly encryption?: TableEncryption;

  /**
   * KMS key used to encrypt the table. Only used when \`encryption\` is
   * \`TableEncryption.CUSTOMER_MANAGED\`. When not provided, a new key is created.
   */
  readonly encryptionKey?: IKey;

  `,
  );

  await applyGritQL(
    tree,
    CDK_DYNAMODB_FILE,
    `${DESTRUCTURE_OLD} => \`{
      tableName,
      runtimeConfigKey,
      billingMode = BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification = { pointInTimeRecoveryEnabled: true },
      deletionProtection = true,
      removalPolicy = RemovalPolicy.RETAIN,
      encryption = TableEncryption.CUSTOMER_MANAGED,
      encryptionKey,
      enableKeyRotation = true,
      ...rest
    }: DynamoDBTableProps\``,
  );

  await applyGritQL(
    tree,
    CDK_DYNAMODB_FILE,
    `${KEY_CREATION_OLD} => \`const key: IKey | undefined =
      encryption === TableEncryption.CUSTOMER_MANAGED
        ? (encryptionKey ?? new Key(this, 'EncryptionKey', { enableKeyRotation }))
        : undefined;\``,
  );

  await applyGritQL(
    tree,
    CDK_DYNAMODB_FILE,
    `${TABLE_ENCRYPTION_OLD} => \`encryption\``,
  );
};

const hcl = (pattern: string) => `language hcl\n${pattern}`;

const NEW_TERRAFORM_VARIABLES_TEXT = [
  'variable "encryption" {',
  '  description = "Server-side encryption for the table. One of CUSTOMER_MANAGED, AWS_MANAGED or DEFAULT (the AWS owned key, at no cost and with no key to manage)."',
  '  type        = string',
  '  default     = "CUSTOMER_MANAGED"',
  '',
  '  validation {',
  '    condition     = contains(["CUSTOMER_MANAGED", "AWS_MANAGED", "DEFAULT"], var.encryption)',
  '    error_message = "encryption must be one of CUSTOMER_MANAGED, AWS_MANAGED or DEFAULT."',
  '  }',
  '}',
  '',
  'variable "kms_key_arn" {',
  '  description = "ARN of an existing KMS key used to encrypt the table when encryption is CUSTOMER_MANAGED. When not provided, a new key is created. Note that a customer-supplied key must already grant the DynamoDB service the necessary permissions in its own key policy."',
  '  type        = string',
  '  default     = null',
  '}',
  '',
  'variable "enable_key_rotation" {',
  '  description = "Whether to enable automatic key rotation on the KMS key used to encrypt the table. Only applies when encryption is CUSTOMER_MANAGED and kms_key_arn is not provided."',
  '  type        = bool',
  '  default     = true',
  '}',
].join('\n');

/**
 * Surface encryption/kms_key_arn on the vended Terraform dynamodb core
 * module.
 */
const migrateTerraformModule = async (
  tree: Tree,
  nextSteps: string[],
): Promise<void> => {
  if (!tree.exists(TERRAFORM_DYNAMODB_FILE)) {
    return; // This workspace has no Terraform dynamodb module.
  }

  if (
    await matchGritQL(
      tree,
      TERRAFORM_DYNAMODB_FILE,
      hcl('`variable "encryption" { $_ }`'),
    )
  ) {
    return; // Already migrated.
  }

  const OLD_ENABLE_KEY_ROTATION_VAR = hcl(
    [
      '`variable "enable_key_rotation" {',
      '  description = "Whether to enable automatic key rotation on the KMS key used to encrypt the table."',
      '  type        = bool',
      '  default     = true',
      '}`',
    ].join('\n'),
  );
  const LOCALS_BLOCK = hcl('`locals { $_ }`');
  const KMS_KEY_BLOCK = hcl('`resource "aws_kms_key" "table" { $_ }`');
  const SSE_ENABLED_LINE = hcl('`enabled = true`');
  const SSE_KMS_KEY_LINE = hcl('`kms_key_arn = aws_kms_key.table.arn`');
  const OUTPUT_VALUE_LINE = hcl('`value = aws_kms_key.table.arn`');

  const anchors = [
    OLD_ENABLE_KEY_ROTATION_VAR,
    LOCALS_BLOCK,
    KMS_KEY_BLOCK,
    SSE_ENABLED_LINE,
    SSE_KMS_KEY_LINE,
    OUTPUT_VALUE_LINE,
  ];

  const allPresent = (
    await Promise.all(
      anchors.map((pattern) =>
        matchGritQL(tree, TERRAFORM_DYNAMODB_FILE, pattern),
      ),
    )
  ).every(Boolean);

  if (!allPresent) {
    nextSteps.push(TERRAFORM_DIVERGED_MESSAGE);
    return;
  }

  // 1. Replace the enable_key_rotation variable with the new variables plus
  //    an updated enable_key_rotation description, in the same position.
  await applyGritQL(
    tree,
    TERRAFORM_DYNAMODB_FILE,
    `${OLD_ENABLE_KEY_ROTATION_VAR} => \`${NEW_TERRAFORM_VARIABLES_TEXT.replace(/`/g, '\\`')}\``,
  );

  // 2. New locals, appended into the existing locals block.
  await insertViaGritQL(
    tree,
    TERRAFORM_DYNAMODB_FILE,
    hcl(
      `\`locals { $body }\` => \`locals {\n  $body\n\n  ${GRIT_INSERT_PLACEHOLDER}\n}\``,
    ),
    [
      'create_table_key = var.encryption == "CUSTOMER_MANAGED" && var.kms_key_arn == null',
      'table_kms_key_arn = (',
      '  var.encryption != "CUSTOMER_MANAGED" ? null :',
      '  local.create_table_key ? aws_kms_key.table[0].arn :',
      '  var.kms_key_arn',
      ')',
    ].join('\n  '),
  );

  // 3. Make the KMS key conditional on encryption/kms_key_arn.
  await applyGritQL(
    tree,
    TERRAFORM_DYNAMODB_FILE,
    hcl(`\`resource "aws_kms_key" "table" { $body }\` => \`resource "aws_kms_key" "table" {
  count = local.create_table_key ? 1 : 0

  $body
}\``),
  );

  // 4. Only enable KMS-backed encryption when not using the AWS owned key.
  await applyGritQL(
    tree,
    TERRAFORM_DYNAMODB_FILE,
    `${SSE_ENABLED_LINE} => \`enabled = var.encryption != "DEFAULT"\``,
  );

  // 4b. Checkov's CKV_AWS_119 only passes when server_side_encryption.enabled
  // is the literal `true` — it can't resolve the conditional above, even
  // though CUSTOMER_MANAGED (the default) always uses a real CMK. Same
  // false-positive shape as CKV_AWS_139 on the vended RDS module.
  await insertViaGritQL(
    tree,
    TERRAFORM_DYNAMODB_FILE,
    hcl(
      `\`resource "aws_dynamodb_table" "table" { $body }\` => \`resource "aws_dynamodb_table" "table" {\n  ${GRIT_INSERT_PLACEHOLDER}\n  $body\n}\``,
    ),
    '#checkov:skip=CKV_AWS_119:Encryption is configurable via var.encryption; checkov cannot resolve the conditional server_side_encryption.enabled expression',
  );

  // 5. Resolve the key ARN through the new local everywhere it's consumed.
  await applyGritQL(
    tree,
    TERRAFORM_DYNAMODB_FILE,
    `${SSE_KMS_KEY_LINE} => \`kms_key_arn = local.table_kms_key_arn\``,
  );
  await applyGritQL(
    tree,
    TERRAFORM_DYNAMODB_FILE,
    `${OUTPUT_VALUE_LINE} => \`value = local.table_kms_key_arn\``,
  );
};

const NEW_APP_MODULE_VARIABLES_TEXT = [
  'variable "encryption" {',
  '  description = "Server-side encryption for the table. One of CUSTOMER_MANAGED, AWS_MANAGED or DEFAULT (the AWS owned key, at no cost and with no key to manage)."',
  '  type        = string',
  '  default     = "CUSTOMER_MANAGED"',
  '',
  '  validation {',
  '    condition     = contains(["CUSTOMER_MANAGED", "AWS_MANAGED", "DEFAULT"], var.encryption)',
  '    error_message = "encryption must be one of CUSTOMER_MANAGED, AWS_MANAGED or DEFAULT."',
  '  }',
  '}',
  '',
  'variable "kms_key_arn" {',
  '  description = "ARN of an existing KMS key used to encrypt the table when encryption is CUSTOMER_MANAGED. When not provided, a new key is created. Note that a customer-supplied key must already grant the DynamoDB service the necessary permissions in its own key policy."',
  '  type        = string',
  '  default     = null',
  '}',
  '',
  'variable "enable_key_rotation" {',
  '  description = "Whether to enable automatic key rotation on the KMS key used to encrypt the table. Only applies when encryption is CUSTOMER_MANAGED and kms_key_arn is not provided."',
  '  type        = bool',
  '  default     = true',
  '}',
].join('\n');

/**
 * Surface the same configuration as pass-through variables on each vended
 * per-table Terraform app module, matching its existing pass-through
 * convention for enable_key_rotation.
 */
const migrateTerraformAppModules = async (
  tree: Tree,
  nextSteps: string[],
): Promise<void> => {
  if (!tree.exists(TERRAFORM_DYNAMODB_APP_DIR)) {
    return;
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

    if (
      await matchGritQL(tree, filePath, hcl('`variable "encryption" { $_ }`'))
    ) {
      continue; // Already migrated.
    }

    const OLD_ENABLE_KEY_ROTATION_VAR = hcl(
      [
        '`variable "enable_key_rotation" {',
        '  description = "Whether to enable automatic key rotation on the KMS key used to encrypt the table."',
        '  type        = bool',
        '  default     = true',
        '}`',
      ].join('\n'),
    );
    const MODULE_BLOCK = hcl('`module "dynamodb_table" { $_ }`');
    const DELETION_PROTECTION_LINE = hcl(
      '`deletion_protection_enabled = var.deletion_protection_enabled`',
    );

    const ready = (
      await Promise.all(
        [
          OLD_ENABLE_KEY_ROTATION_VAR,
          MODULE_BLOCK,
          DELETION_PROTECTION_LINE,
        ].map((pattern) => matchGritQL(tree, filePath, pattern)),
      )
    ).every(Boolean);

    if (!ready) {
      nextSteps.push(terraformAppDivergedMessage(filePath));
      continue;
    }

    await applyGritQL(
      tree,
      filePath,
      `${OLD_ENABLE_KEY_ROTATION_VAR} => \`${NEW_APP_MODULE_VARIABLES_TEXT.replace(/`/g, '\\`')}\``,
    );

    await insertViaGritQL(
      tree,
      filePath,
      hcl(
        `\`deletion_protection_enabled = var.deletion_protection_enabled\` => \`deletion_protection_enabled = var.deletion_protection_enabled\n  ${GRIT_INSERT_PLACEHOLDER}\``,
      ),
      ['encryption   = var.encryption', 'kms_key_arn  = var.kms_key_arn'].join(
        '\n  ',
      ),
    );
  }
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  await migrateCdkConstruct(tree, nextSteps);
  await migrateTerraformModule(tree, nextSteps);
  await migrateTerraformAppModules(tree, nextSteps);

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
