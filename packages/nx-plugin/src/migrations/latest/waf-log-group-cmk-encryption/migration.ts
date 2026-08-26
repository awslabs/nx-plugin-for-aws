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
} from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../../../utils/shared-constructs-constants.js';

/**
 * WAF request logs carry full request metadata - URIs, headers and client IPs -
 * so the vended WAF log groups are encrypted with a customer-managed KMS key,
 * matching how the vended access log groups beside them already are. Three were
 * plaintext: the Terraform REST API and user-pool WAF log groups, the Terraform
 * AgentCore gateway WAF log group, and the CDK user-pool WAF log group. Each now
 * gets a key whose policy grants CloudWatch Logs use of it, scoped by
 * `kms:EncryptionContext:aws:logs:arn` to that log group alone.
 *
 * CloudWatch Logs cannot encrypt a log group that already exists in place, so
 * this only rewrites the vended templates. On the next deploy Terraform sets
 * `kms_key_id` on the existing group (an in-place update) and CloudFormation
 * replaces the CDK one, which the vended `RemovalPolicy.DESTROY` already allows.
 * Events written before then stay unencrypted; the `nextSteps` note says so.
 */

const CONSTRUCTS_SRC = `${PACKAGES_DIR}/${SHARED_CONSTRUCTS_DIR}/src`;
const TERRAFORM_SRC = `${PACKAGES_DIR}/${SHARED_TERRAFORM_DIR}/src`;

const CDK_USER_IDENTITY_FILE = `${CONSTRUCTS_SRC}/core/user-identity.ts`;
const TERRAFORM_REST_API_FILE = `${TERRAFORM_SRC}/core/api/rest/rest-api/rest-api.tf`;
const TERRAFORM_USER_IDENTITY_FILE = `${TERRAFORM_SRC}/core/user-identity/identity/identity.tf`;
const TERRAFORM_GATEWAYS_DIR = `${TERRAFORM_SRC}/app/gateways`;

const divergedMessage = (file: string) =>
  `${file}: the WAF log group has diverged from the generated shape - left untouched. Its request logs stay unencrypted. To encrypt them, add a customer-managed KMS key granting the \`logs.<region>.amazonaws.com\` service principal kms:Encrypt/Decrypt/ReEncrypt*/GenerateDataKey*/DescribeKey, conditioned on \`kms:EncryptionContext:aws:logs:arn\` matching the log group, and point the log group at it (see the vended WAF log group template).`;

const ALREADY_ENCRYPTED_TERRAFORM = 'aws_kms_key.';

// Terraform (HCL) patterns are built from plain strings rather than JS template
// literals, since the HCL text itself is full of `${...}` interpolations that
// would otherwise be parsed as JS interpolation.
const hcl = (pattern: string) => 'language hcl\n' + pattern;

/** A vended Terraform WAF log group and the key this migration gives it. */
interface TerraformWafLogGroup {
  /** The `aws_cloudwatch_log_group` resource label. */
  readonly logGroupLabel: string;
  /** The `aws_kms_key` / `aws_kms_alias` label to create. */
  readonly keyLabel: string;
  /** The `locals` entry the log group name moves into. */
  readonly nameLocal: string;
  /** The log group's name expression, which becomes the local's value. */
  readonly nameExpression: string;
  /** The KMS key description. */
  readonly keyDescription: string;
  /** The KMS alias name expression. */
  readonly aliasName: string;
  /** How the account id is referenced in this module. */
  readonly accountId: string;
  /** How the region is referenced in this module. */
  readonly region: string;
  /** Whether the module tags its resources. */
  readonly tagged: boolean;
}

const REST_API_LOG_GROUP: TerraformWafLogGroup = {
  logGroupLabel: 'api_waf_logs',
  keyLabel: 'waf_logs',
  nameLocal: 'waf_log_group_name',
  nameExpression:
    'var.enable_waf ? "aws-waf-logs-${var.api_name}-${random_id.waf_log_suffix[0].hex}" : null',
  keyDescription: '"${var.api_name} API WAF log encryption"',
  aliasName:
    '"alias/${var.api_name}-${random_id.waf_log_suffix[0].hex}-waf-logs"',
  accountId: 'data.aws_caller_identity.current.account_id',
  region: 'data.aws_region.current.region',
  tagged: true,
};

const USER_IDENTITY_LOG_GROUP: TerraformWafLogGroup = {
  logGroupLabel: 'user_pool_waf_logs',
  keyLabel: 'user_pool_waf_logs',
  nameLocal: 'user_pool_waf_log_group_name',
  nameExpression:
    'var.enable_waf ? "aws-waf-logs-UserPool-${random_id.unique_suffix.hex}" : null',
  keyDescription: '"User pool WAF log encryption"',
  aliasName: '"alias/user-pool-${random_id.unique_suffix.hex}-waf-logs"',
  accountId: 'data.aws_caller_identity.current.account_id',
  region: 'data.aws_region.current.region',
  tagged: false,
};

const gatewayLogGroup = (nameKebabCase: string): TerraformWafLogGroup => ({
  logGroupLabel: 'gateway_waf_logs',
  keyLabel: 'gateway_waf_logs',
  nameLocal: 'gateway_waf_log_group_name',
  nameExpression: `var.enable_waf ? "aws-waf-logs-${nameKebabCase}-\${random_id.unique_suffix.hex}" : null`,
  keyDescription: `"${nameKebabCase} gateway WAF log encryption"`,
  aliasName: `"alias/${nameKebabCase}-\${random_id.unique_suffix.hex}-waf-logs"`,
  accountId: 'local.aws_account_id',
  region: 'local.aws_region',
  tagged: false,
});

/** The KMS key and alias resources, as the templates now vend them. */
const keyResourcesText = (group: TerraformWafLogGroup): string =>
  [
    '# KMS key for encrypting WAF request logs at rest',
    `resource "aws_kms_key" "${group.keyLabel}" {`,
    '  count = var.enable_waf ? 1 : 0',
    '',
    `  description             = ${group.keyDescription}`,
    '  deletion_window_in_days = 7',
    '  enable_key_rotation     = true',
    '',
    '  policy = jsonencode({',
    '    Version = "2012-10-17"',
    '    Statement = [',
    '      {',
    '        Sid       = "Enable IAM User Permissions"',
    '        Effect    = "Allow"',
    `        Principal = { AWS = "arn:aws:iam::\${${group.accountId}}:root" }`,
    '        Action    = "kms:*"',
    '        Resource  = "*"',
    '      },',
    '      {',
    '        Sid       = "Allow CloudWatch Logs"',
    '        Effect    = "Allow"',
    `        Principal = { Service = "logs.\${${group.region}}.amazonaws.com" }`,
    '        Action = [',
    '          "kms:Encrypt",',
    '          "kms:Decrypt",',
    '          "kms:ReEncrypt*",',
    '          "kms:GenerateDataKey*",',
    '          "kms:DescribeKey"',
    '        ]',
    '        Resource = "*"',
    '        Condition = {',
    '          ArnEquals = {',
    `            "kms:EncryptionContext:aws:logs:arn" = "arn:aws:logs:\${${group.region}}:\${${group.accountId}}:log-group:\${local.${group.nameLocal}}"`,
    '          }',
    '        }',
    '      }',
    '    ]',
    '  })',
    ...(group.tagged ? ['', '  tags = var.tags'] : []),
    '}',
    '',
    `resource "aws_kms_alias" "${group.keyLabel}" {`,
    '  count = var.enable_waf ? 1 : 0',
    '',
    `  name          = ${group.aliasName}`,
    `  target_key_id = aws_kms_key.${group.keyLabel}[0].key_id`,
    '}',
  ].join('\n');

const migrateTerraformLogGroup = async (
  tree: Tree,
  file: string,
  group: TerraformWafLogGroup,
  nextSteps: string[],
): Promise<void> => {
  const contents = tree.read(file, 'utf-8') ?? '';

  // The WAF log group is only vended when WAF is enabled, so it may be absent.
  if (
    !contents.includes(`"aws_cloudwatch_log_group" "${group.logGroupLabel}"`)
  ) {
    return;
  }

  const LOG_GROUP_BLOCK = hcl(
    `\`resource "aws_cloudwatch_log_group" "${group.logGroupLabel}" { $body }\``,
  );
  const NAME_LINE = hcl(
    `\`name = ${group.nameExpression.replace(/^var\.enable_waf \? /, '').replace(/ : null$/, '')}\` as $line where {\n` +
      `  $line <: within \`resource "aws_cloudwatch_log_group" "${group.logGroupLabel}" { $_ }\`\n` +
      '}',
  );
  const SUPPRESSION_LINE =
    '#checkov:skip=CKV_AWS_158:Using default CloudWatch log encryption';
  const LOCALS_BLOCK = hcl('`locals { $body }`');

  if (contents.includes(ALREADY_ENCRYPTED_TERRAFORM + group.keyLabel)) {
    return; // Already migrated.
  }

  const ready =
    (await matchGritQL(tree, file, LOG_GROUP_BLOCK)) &&
    (await matchGritQL(tree, file, NAME_LINE)) &&
    (await matchGritQL(tree, file, LOCALS_BLOCK)) &&
    contents.includes(SUPPRESSION_LINE);

  if (!ready) {
    nextSteps.push(divergedMessage(file));
    return;
  }

  // 1. Route the log group name through a local, so the key policy's encryption
  //    context condition can name the same log group.
  await insertViaGritQL(
    tree,
    file,
    LOCALS_BLOCK +
      ` as $l => \`locals {\n  $body\n  ${GRIT_INSERT_PLACEHOLDER}\n}\``,
    `${group.nameLocal} = ${group.nameExpression}`,
  );
  await applyGritQL(
    tree,
    file,
    NAME_LINE + ` => \`name              = local.${group.nameLocal}\``,
  );

  // 2. Point the log group at a new key, added after it so the log group keeps
  //    the comment above it.
  await insertViaGritQL(
    tree,
    file,
    hcl(
      `\`name = local.${group.nameLocal}\` as $line where {\n` +
        `  $line <: within \`resource "aws_cloudwatch_log_group" "${group.logGroupLabel}" { $_ }\`\n` +
        '}',
    ) + ` => \`$line\n  ${GRIT_INSERT_PLACEHOLDER}\``,
    `kms_key_id        = aws_kms_key.${group.keyLabel}[0].arn`,
  );
  await insertViaGritQL(
    tree,
    file,
    LOG_GROUP_BLOCK + ` as $lg => \`$lg\n\n${GRIT_INSERT_PLACEHOLDER}\``,
    keyResourcesText(group),
  );

  // 3. Drop the suppression the encryption makes redundant.
  const updated = (tree.read(file, 'utf-8') ?? '')
    .split('\n')
    .filter((line) => line.trim() !== SUPPRESSION_LINE)
    .join('\n');
  tree.write(file, updated);
};

/**
 * The vended CDK user-pool WAF log group gains an `encryptionKey`, matching the
 * eight sibling CDK WAF log groups which already pass one.
 */
const migrateCdkUserIdentity = async (
  tree: Tree,
  nextSteps: string[],
): Promise<void> => {
  if (!tree.exists(CDK_USER_IDENTITY_FILE)) {
    return; // This workspace has no CDK user identity construct.
  }

  const contents = tree.read(CDK_USER_IDENTITY_FILE, 'utf-8') ?? '';

  // The WAF web ACL (and its log group) is optional, so it may be absent.
  if (!contents.includes(`new LogGroup(this, 'WebAclLogs'`)) {
    return;
  }

  if (contents.includes('WebAclLogsKey')) {
    return; // Already migrated.
  }

  // Already encrypted, whether by this migration or by the user's own key.
  if (
    await matchGritQL(
      tree,
      CDK_USER_IDENTITY_FILE,
      "`new LogGroup(this, 'WebAclLogs', { $props })` where { $props <: contains `encryptionKey` }",
    )
  ) {
    return;
  }

  const LOG_GROUP =
    "`new LogGroup(this, 'WebAclLogs', { $props })` as $lg where { $props <: contains `logGroupName: $name` }";
  const SUPPRESS_CALL =
    "`suppressRules(wafLogGroup, ['CKV_AWS_158'], $reason)` as $call";

  const ready =
    (await matchGritQL(tree, CDK_USER_IDENTITY_FILE, LOG_GROUP)) &&
    (await matchGritQL(tree, CDK_USER_IDENTITY_FILE, SUPPRESS_CALL));

  if (!ready) {
    nextSteps.push(divergedMessage(CDK_USER_IDENTITY_FILE));
    return;
  }

  await addDestructuredImport(
    tree,
    CDK_USER_IDENTITY_FILE,
    ['Key'],
    'aws-cdk-lib/aws-kms',
  );
  await addDestructuredImport(
    tree,
    CDK_USER_IDENTITY_FILE,
    ['Effect', 'PolicyStatement', 'ServicePrincipal'],
    'aws-cdk-lib/aws-iam',
  );

  // Hoist the log group name into a const so the key policy's encryption context
  // condition can name the same log group, then create the key above the group.
  await insertViaGritQL(
    tree,
    CDK_USER_IDENTITY_FILE,
    "`const wafLogGroup = new LogGroup(this, 'WebAclLogs', { $props })` as $decl => " +
      `\`${GRIT_INSERT_PLACEHOLDER}\n\n$decl\``,
    `const stack = Stack.of(this);
    const wafLogGroupName = \`aws-waf-logs-\${id}-\${this.node.addr.slice(-8)}\`;

    // KMS key for encrypting WAF logs at rest, usable by CloudWatch Logs
    const logsKey = new Key(this, 'WebAclLogsKey', {
      enableKeyRotation: true,
    });
    logsKey.addToResourcePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        principals: [new ServicePrincipal(\`logs.\${stack.region}.amazonaws.com\`)],
        actions: [
          'kms:Encrypt',
          'kms:Decrypt',
          'kms:ReEncrypt*',
          'kms:GenerateDataKey*',
          'kms:DescribeKey',
        ],
        resources: ['*'],
        conditions: {
          ArnEquals: {
            'kms:EncryptionContext:aws:logs:arn': \`arn:aws:logs:\${stack.region}:\${stack.account}:log-group:\${wafLogGroupName}\`,
          },
        },
      }),
    );`,
  );

  await applyGritQL(
    tree,
    CDK_USER_IDENTITY_FILE,
    "`logGroupName: $name` as $prop where { $prop <: within `new LogGroup(this, 'WebAclLogs', $_)` } => `logGroupName: wafLogGroupName,\n      encryptionKey: logsKey`",
  );

  // Drop the suppression the encryption makes redundant.
  await applyGritQL(tree, CDK_USER_IDENTITY_FILE, SUPPRESS_CALL + ' => ``');
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  if (tree.exists(TERRAFORM_REST_API_FILE)) {
    await migrateTerraformLogGroup(
      tree,
      TERRAFORM_REST_API_FILE,
      REST_API_LOG_GROUP,
      nextSteps,
    );
  }
  if (tree.exists(TERRAFORM_USER_IDENTITY_FILE)) {
    await migrateTerraformLogGroup(
      tree,
      TERRAFORM_USER_IDENTITY_FILE,
      USER_IDENTITY_LOG_GROUP,
      nextSteps,
    );
  }
  if (tree.exists(TERRAFORM_GATEWAYS_DIR)) {
    for (const dirName of tree.children(TERRAFORM_GATEWAYS_DIR)) {
      const file = joinPathFragments(
        TERRAFORM_GATEWAYS_DIR,
        dirName,
        `${dirName}.tf`,
      );
      if (tree.exists(file)) {
        await migrateTerraformLogGroup(
          tree,
          file,
          gatewayLogGroup(dirName),
          nextSteps,
        );
      }
    }
  }

  await migrateCdkUserIdentity(tree, nextSteps);

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
