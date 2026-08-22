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
  captureGritQLVariable,
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
 * Bring existing workspaces up to the generators' current StaticWebsite
 * configurability:
 *
 * - The vended `StaticWebsite` CDK construct gains `enableWaf`, `encryption`,
 *   `encryptionKey` and `enableKeyRotation` props. The WAF Web ACL is now
 *   optional, the KMS key used to encrypt the website and distribution log
 *   buckets is now overridable (or skippable in favour of another
 *   `BucketEncryption`), and the auto-created key's rotation is configurable.
 * - Each vended per-website app construct (`app/static-websites/*.ts`) gains
 *   an optional `props` constructor parameter so these can be configured per
 *   app, rather than only by hand-editing the vended construct.
 * - The vended Terraform static-website core module gains the equivalent
 *   `enable_waf`, `encryption`, `kms_key_arn` and `enable_key_rotation`
 *   variables.
 * - Each vended per-website Terraform app module (`app/static-websites/<name>/<name>.tf`)
 *   gains pass-through `custom_domain_names`, `acm_certificate_arn`,
 *   `enable_waf`, `encryption`, `kms_key_arn` and `enable_key_rotation`
 *   variables forwarded to the core module call, matching the pass-through
 *   convention every other app-wraps-core Terraform module in this plugin
 *   already follows (`rdb`, `agent-core`, `dcr-proxies`, the REST/HTTP API).
 *
 * These files are generated with `KeepExisting`, so without this an upgraded
 * workspace has generators that support this configuration but vended files
 * that don't. Diverged files are left untouched and reported via `nextSteps`.
 */

const CDK_STATIC_WEBSITE_FILE = `${PACKAGES_DIR}/${SHARED_CONSTRUCTS_DIR}/src/core/static-website.ts`;
const CDK_STATIC_WEBSITES_APP_DIR = `${PACKAGES_DIR}/${SHARED_CONSTRUCTS_DIR}/src/app/static-websites`;
const TERRAFORM_STATIC_WEBSITE_FILE = `${PACKAGES_DIR}/${SHARED_TERRAFORM_DIR}/src/core/static-website/static-website.tf`;
const TERRAFORM_STATIC_WEBSITES_APP_DIR = `${PACKAGES_DIR}/${SHARED_TERRAFORM_DIR}/src/app/static-websites`;

const CDK_DIVERGED_MESSAGE = `${CDK_STATIC_WEBSITE_FILE}: has diverged from the generated shape - left untouched. To pick up the enableWaf, encryption, encryptionKey and enableKeyRotation props, manually port them from the vended core/static-website.ts template (see the ts#react-website generator's static-website construct).`;

const TERRAFORM_DIVERGED_MESSAGE = `${TERRAFORM_STATIC_WEBSITE_FILE}: has diverged from the generated shape - left untouched. To pick up the enable_waf, encryption, kms_key_arn and enable_key_rotation variables, manually port them from the vended static-website.tf template (see the ts#react-website generator's static-website module).`;

const terraformAppDivergedMessage = (filePath: string) =>
  `${filePath}: has diverged from the generated shape - left untouched. To make custom_domain_names, acm_certificate_arn, enable_waf, encryption, kms_key_arn and enable_key_rotation configurable from your root Terraform configuration, add pass-through variables here and forward them to the static_website module call (see the ts#react-website generator's static-websites app template).`;

// The doc comments below carry backticked markdown, which must stay out of
// the GritQL pattern that inserts this text (see insertViaGritQL). It's routed
// in as plain text via the placeholder instead.
const STATIC_WEBSITE_PROPS_TEXT = `/**
   * Whether to protect the CloudFront distribution with an AWS WAF Web ACL.
   *
   * @default true
   */
  readonly enableWaf?: boolean;
  /**
   * Server-side encryption for the website and distribution log buckets.
   *
   * @default BucketEncryption.KMS
   */
  readonly encryption?: BucketEncryption;
  /**
   * KMS key used to encrypt the website and distribution log buckets. Only used when \`encryption\` is
   * \`BucketEncryption.KMS\`. When not provided, a new key is created.
   */
  readonly encryptionKey?: IKey;
  /**
   * Whether the automatically created KMS key has rotation enabled. Only applies when \`encryption\` is
   * \`BucketEncryption.KMS\` and no \`encryptionKey\` is supplied.
   *
   * @default true
   */
  readonly enableKeyRotation?: boolean`;

/**
 * Surface enableWaf/encryption/encryptionKey/enableKeyRotation on the vended
 * StaticWebsite CDK construct.
 */
const migrateCdkConstruct = async (
  tree: Tree,
  nextSteps: string[],
): Promise<void> => {
  if (!tree.exists(CDK_STATIC_WEBSITE_FILE)) {
    return; // This workspace has no CDK static website construct.
  }

  if (
    await matchGritQL(
      tree,
      CDK_STATIC_WEBSITE_FILE,
      '`readonly enableWaf?: boolean`',
    )
  ) {
    return; // Already migrated.
  }

  const CERTIFICATE_FIELD = '`readonly certificate?: ICertificate`';
  const DESTRUCTURE_OLD =
    '`{ websiteFilePath, websiteName, domainNames, certificate }: StaticWebsiteProps`';
  const KEY_CREATION_OLD =
    "`const websiteKey = new Key(this, 'WebsiteKey', { enableKeyRotation: true })`";
  const ADD_TO_RESOURCE_POLICY_OLD = '`websiteKey.addToResourcePolicy($args)`';
  const WEBSITE_BUCKET_ENCRYPTION_OLD =
    "`encryption: BucketEncryption.KMS` as $prop where { $prop <: within `new Bucket($_, 'WebsiteBucket', $_)` }";
  const DISTRIBUTION_LOGS_BUCKET_ENCRYPTION_OLD =
    "`encryption: BucketEncryption.KMS` as $prop where { $prop <: within `new Bucket($_, 'DistributionLogBucket', $_)` }";
  const WAF_STACK_OLD = "`const wafStack = new CloudfrontWebAcl(this, 'waf')`";
  const WEB_ACL_ID_OLD = '`webAclId: wafStack.wafArn`';

  const anchors = [
    CERTIFICATE_FIELD,
    DESTRUCTURE_OLD,
    KEY_CREATION_OLD,
    ADD_TO_RESOURCE_POLICY_OLD,
    WEBSITE_BUCKET_ENCRYPTION_OLD,
    DISTRIBUTION_LOGS_BUCKET_ENCRYPTION_OLD,
    WAF_STACK_OLD,
    WEB_ACL_ID_OLD,
  ];

  const allPresent = (
    await Promise.all(
      anchors.map((pattern) =>
        matchGritQL(tree, CDK_STATIC_WEBSITE_FILE, pattern),
      ),
    )
  ).every(Boolean);

  if (!allPresent) {
    nextSteps.push(CDK_DIVERGED_MESSAGE);
    return;
  }

  await addDestructuredImport(
    tree,
    CDK_STATIC_WEBSITE_FILE,
    ['IKey'],
    'aws-cdk-lib/aws-kms',
  );

  await insertViaGritQL(
    tree,
    CDK_STATIC_WEBSITE_FILE,
    `${CERTIFICATE_FIELD} as $field => \`$field;
  ${GRIT_INSERT_PLACEHOLDER}\``,
    STATIC_WEBSITE_PROPS_TEXT,
  );

  await applyGritQL(
    tree,
    CDK_STATIC_WEBSITE_FILE,
    `${DESTRUCTURE_OLD} => \`{
      websiteFilePath,
      websiteName,
      domainNames,
      certificate,
      enableWaf = true,
      encryption = BucketEncryption.KMS,
      encryptionKey,
      enableKeyRotation = true,
    }: StaticWebsiteProps\``,
  );

  await applyGritQL(
    tree,
    CDK_STATIC_WEBSITE_FILE,
    `${KEY_CREATION_OLD} => \`const websiteKey: IKey | undefined =
      encryption === BucketEncryption.KMS
        ? (encryptionKey ?? new Key(this, 'WebsiteKey', { enableKeyRotation }))
        : undefined;\``,
  );

  await applyGritQL(
    tree,
    CDK_STATIC_WEBSITE_FILE,
    `${ADD_TO_RESOURCE_POLICY_OLD} => \`websiteKey?.addToResourcePolicy($args)\``,
  );

  await applyGritQL(
    tree,
    CDK_STATIC_WEBSITE_FILE,
    `${WEBSITE_BUCKET_ENCRYPTION_OLD} => \`encryption\``,
  );

  await applyGritQL(
    tree,
    CDK_STATIC_WEBSITE_FILE,
    `${DISTRIBUTION_LOGS_BUCKET_ENCRYPTION_OLD} => \`encryption\``,
  );

  await applyGritQL(
    tree,
    CDK_STATIC_WEBSITE_FILE,
    `${WAF_STACK_OLD} => \`const wafStack = enableWaf ? new CloudfrontWebAcl(this, 'waf') : undefined;\``,
  );

  await applyGritQL(
    tree,
    CDK_STATIC_WEBSITE_FILE,
    `${WEB_ACL_ID_OLD} => \`webAclId: wafStack?.wafArn\``,
  );
};

/**
 * Surface the same props on each vended per-website app construct, so they
 * can be configured per app rather than only by editing the shared construct.
 */
const migrateCdkAppConstructs = async (
  tree: Tree,
  nextSteps: string[],
): Promise<void> => {
  if (!tree.exists(CDK_STATIC_WEBSITES_APP_DIR)) {
    return;
  }

  for (const fileName of tree.children(CDK_STATIC_WEBSITES_APP_DIR)) {
    if (fileName === 'index.ts' || !fileName.endsWith('.ts')) {
      continue;
    }
    const filePath = joinPathFragments(CDK_STATIC_WEBSITES_APP_DIR, fileName);

    const contents = tree.read(filePath, 'utf-8') ?? '';
    if (contents.includes('StaticWebsiteProps')) {
      continue; // Already migrated.
    }

    const name = await captureGritQLVariable(
      tree,
      filePath,
      '`export class $name extends StaticWebsite { $_ }`',
      'name',
    );
    if (!name) {
      continue; // Not a StaticWebsite subclass, not ours to touch.
    }

    const importPattern = '`import { StaticWebsite } from $path`';
    const ctorPattern = '`constructor(scope: Construct, id: string) { $body }`';
    // Captures the whole property list rather than anchoring on websiteName
    // being followed by exactly one more property ($rest binds a single
    // trailing node, not a variadic list). This must still match when a
    // workspace already customised the super() call with e.g. domainNames
    // and certificate (the pre-existing documented customization point).
    const superPattern = `\`super(scope, id, { $props })\` as $call where {
  $props <: contains \`websiteName: '${name}'\`
}`;

    const ready = (
      await Promise.all(
        [importPattern, ctorPattern, superPattern].map((pattern) =>
          matchGritQL(tree, filePath, pattern),
        ),
      )
    ).every(Boolean);

    if (!ready) {
      nextSteps.push(
        `${filePath}: has diverged from the generated shape - left untouched. To make enableWaf, encryption, encryptionKey and enableKeyRotation configurable here, add an optional \`props?: ${name}Props\` constructor parameter (\`Omit<StaticWebsiteProps, 'websiteName' | 'websiteFilePath'>\`) and spread it into the super() call (see the ts#react-website generator's static-websites app template).`,
      );
      continue;
    }

    await applyGritQL(
      tree,
      filePath,
      `${importPattern} => \`import { StaticWebsite, StaticWebsiteProps } from $path\``,
    );

    await insertViaGritQL(
      tree,
      filePath,
      `\`export class ${name} extends StaticWebsite { $body }\` as $cls => \`${GRIT_INSERT_PLACEHOLDER}

$cls\``,
      `export type ${name}Props = Omit<\n  StaticWebsiteProps,\n  'websiteName' | 'websiteFilePath'\n>;`,
    );

    await applyGritQL(
      tree,
      filePath,
      `${ctorPattern} => \`constructor(scope: Construct, id: string, props?: ${name}Props) { $body }\``,
    );

    await applyGritQL(
      tree,
      filePath,
      `${superPattern} => \`super(scope, id, { ...props, $props })\``,
    );
  }
};

// Terraform (HCL) patterns are built from plain strings rather than JS
// template literals, since the HCL text itself is full of `${...}`
// interpolations that would otherwise be parsed as JS interpolation.
const hcl = (pattern: string) => 'language hcl\n' + pattern;

const withinResource = (
  linePattern: string,
  resourceType: string,
  resourceLabel: string,
) =>
  hcl(
    '`' +
      linePattern +
      '` as $line where {\n' +
      '  $line <: within `resource "' +
      resourceType +
      '" "' +
      resourceLabel +
      '" { $_ }`\n' +
      '}',
  );

const NEW_VARIABLES_TEXT = [
  'variable "enable_waf" {',
  '  description = "Whether to protect the CloudFront distribution with an AWS WAF Web ACL."',
  '  type        = bool',
  '  default     = true',
  '}',
  '',
  'variable "encryption" {',
  '  description = "Server-side encryption for the website and distribution log buckets. One of KMS or S3_MANAGED."',
  '  type        = string',
  '  default     = "KMS"',
  '',
  '  validation {',
  '    condition     = contains(["KMS", "S3_MANAGED"], var.encryption)',
  '    error_message = "encryption must be one of KMS or S3_MANAGED."',
  '  }',
  '}',
  '',
  'variable "kms_key_arn" {',
  '  description = "ARN of an existing KMS key used to encrypt the website and distribution log buckets when encryption is KMS. When not provided, a new key is created. Note that a customer-supplied key must already grant the CloudWatch Logs, S3 and CloudFront service principals the necessary permissions in its own key policy."',
  '  type        = string',
  '  default     = null',
  '}',
  '',
  'variable "enable_key_rotation" {',
  '  description = "Whether the automatically created KMS key has rotation enabled. Only applies when encryption is KMS and kms_key_arn is not provided."',
  '  type        = bool',
  '  default     = true',
  '}',
].join('\n');

const NEW_LOCALS_TEXT = [
  '',
  '  create_website_key = var.encryption == "KMS" && var.kms_key_arn == null',
  '  website_kms_key_arn = (',
  '    var.encryption != "KMS" ? null :',
  '    local.create_website_key ? aws_kms_key.website_key[0].arn :',
  '    var.kms_key_arn',
  '  )',
].join('\n');

/**
 * Surface the same configuration on the vended Terraform static-website
 * module.
 */
const migrateTerraformModule = async (
  tree: Tree,
  nextSteps: string[],
): Promise<void> => {
  if (!tree.exists(TERRAFORM_STATIC_WEBSITE_FILE)) {
    return; // This workspace has no Terraform static website module.
  }

  if (
    await matchGritQL(
      tree,
      TERRAFORM_STATIC_WEBSITE_FILE,
      hcl('`variable "enable_waf" { $_ }`'),
    )
  ) {
    return; // Already migrated.
  }

  const ACM_CERT_VARIABLE = hcl('`variable "acm_certificate_arn" { $_ }`');
  const ACCESS_LOGS_LOCAL = hcl(
    '`access_logs_name_prefix = substr(lower(var.website_name), 0, 16)`',
  );
  const KMS_KEY_BLOCK = hcl('`resource "aws_kms_key" "website_key" { $_ }`');
  const KMS_KEY_ROTATION_LINE = withinResource(
    'enable_key_rotation = true',
    'aws_kms_key',
    'website_key',
  );
  const KMS_ALIAS_BLOCK = hcl(
    '`resource "aws_kms_alias" "website_key_alias" { $_ }`',
  );
  const KMS_ALIAS_TARGET_LINE = hcl(
    '`target_key_id = aws_kms_key.website_key.key_id`',
  );
  const LOG_GROUP_KMS_LINE = hcl('`kms_key_id = aws_kms_key.website_key.arn`');
  const WEBSITE_ENCRYPTION_KEY_LINE = withinResource(
    'kms_master_key_id = aws_kms_key.website_key.arn',
    'aws_s3_bucket_server_side_encryption_configuration',
    'website_encryption',
  );
  const WEBSITE_ENCRYPTION_ALGO_LINE = withinResource(
    'sse_algorithm = "aws:kms"',
    'aws_s3_bucket_server_side_encryption_configuration',
    'website_encryption',
  );
  const DISTRIBUTION_LOGS_ENCRYPTION_KEY_LINE = withinResource(
    'kms_master_key_id = aws_kms_key.website_key.arn',
    'aws_s3_bucket_server_side_encryption_configuration',
    'distribution_logs_encryption',
  );
  const DISTRIBUTION_LOGS_ENCRYPTION_ALGO_LINE = withinResource(
    'sse_algorithm = "aws:kms"',
    'aws_s3_bucket_server_side_encryption_configuration',
    'distribution_logs_encryption',
  );
  const WAF_BLOCK = hcl(
    '`resource "aws_wafv2_web_acl" "cloudfront_waf" { $_ }`',
  );
  const WEB_ACL_ID_LINE = hcl(
    '`web_acl_id = aws_wafv2_web_acl.cloudfront_waf.arn`',
  );
  const WAF_OUTPUT_VALUE_LINE = hcl(
    '`value = aws_wafv2_web_acl.cloudfront_waf.arn` as $line where {\n' +
      '  $line <: within `output "waf_web_acl_arn" { $_ }`\n' +
      '}',
  );

  const anchors = [
    ACM_CERT_VARIABLE,
    ACCESS_LOGS_LOCAL,
    KMS_KEY_BLOCK,
    KMS_KEY_ROTATION_LINE,
    KMS_ALIAS_BLOCK,
    KMS_ALIAS_TARGET_LINE,
    LOG_GROUP_KMS_LINE,
    WEBSITE_ENCRYPTION_KEY_LINE,
    WEBSITE_ENCRYPTION_ALGO_LINE,
    DISTRIBUTION_LOGS_ENCRYPTION_KEY_LINE,
    DISTRIBUTION_LOGS_ENCRYPTION_ALGO_LINE,
    WAF_BLOCK,
    WEB_ACL_ID_LINE,
    WAF_OUTPUT_VALUE_LINE,
  ];

  const allPresent = (
    await Promise.all(
      anchors.map((pattern) =>
        matchGritQL(tree, TERRAFORM_STATIC_WEBSITE_FILE, pattern),
      ),
    )
  ).every(Boolean);

  if (!allPresent) {
    nextSteps.push(TERRAFORM_DIVERGED_MESSAGE);
    return;
  }

  // 1. New variables, after acm_certificate_arn. Routed through the
  //    placeholder since the variable descriptions contain double-quoted
  //    HCL string values.
  await insertViaGritQL(
    tree,
    TERRAFORM_STATIC_WEBSITE_FILE,
    hcl(
      '`variable "acm_certificate_arn" { $body }` as $var => `$var\n\n' +
        GRIT_INSERT_PLACEHOLDER +
        '`',
    ),
    NEW_VARIABLES_TEXT,
  );

  // 2. New locals, after access_logs_name_prefix.
  await insertViaGritQL(
    tree,
    TERRAFORM_STATIC_WEBSITE_FILE,
    hcl(
      '`access_logs_name_prefix = substr(lower(var.website_name), 0, 16)` as $line => `$line\n' +
        GRIT_INSERT_PLACEHOLDER +
        '`',
    ),
    NEW_LOCALS_TEXT,
  );

  // 3. Make the KMS key and alias conditional on encryption/kms_key_arn.
  await applyGritQL(
    tree,
    TERRAFORM_STATIC_WEBSITE_FILE,
    hcl(
      '`resource "aws_kms_key" "website_key" { $body }` => `resource "aws_kms_key" "website_key" {\n' +
        '  count = local.create_website_key ? 1 : 0\n\n' +
        '  $body\n' +
        '}`',
    ),
  );
  await applyGritQL(
    tree,
    TERRAFORM_STATIC_WEBSITE_FILE,
    KMS_KEY_ROTATION_LINE +
      ' => `enable_key_rotation = var.enable_key_rotation`',
  );
  await applyGritQL(
    tree,
    TERRAFORM_STATIC_WEBSITE_FILE,
    hcl(
      '`resource "aws_kms_alias" "website_key_alias" { $body }` => `resource "aws_kms_alias" "website_key_alias" {\n' +
        '  count = local.create_website_key ? 1 : 0\n\n' +
        '  $body\n' +
        '}`',
    ),
  );
  await applyGritQL(
    tree,
    TERRAFORM_STATIC_WEBSITE_FILE,
    KMS_ALIAS_TARGET_LINE +
      ' => `target_key_id = aws_kms_key.website_key[0].key_id`',
  );

  // 4. Resolve the key ARN through the new local everywhere it's consumed.
  await applyGritQL(
    tree,
    TERRAFORM_STATIC_WEBSITE_FILE,
    LOG_GROUP_KMS_LINE + ' => `kms_key_id = local.website_kms_key_arn`',
  );
  await applyGritQL(
    tree,
    TERRAFORM_STATIC_WEBSITE_FILE,
    WEBSITE_ENCRYPTION_KEY_LINE +
      ' => `kms_master_key_id = var.encryption == "KMS" ? local.website_kms_key_arn : null`',
  );
  await applyGritQL(
    tree,
    TERRAFORM_STATIC_WEBSITE_FILE,
    WEBSITE_ENCRYPTION_ALGO_LINE +
      ' => `sse_algorithm = var.encryption == "KMS" ? "aws:kms" : "AES256"`',
  );
  await applyGritQL(
    tree,
    TERRAFORM_STATIC_WEBSITE_FILE,
    DISTRIBUTION_LOGS_ENCRYPTION_KEY_LINE +
      ' => `kms_master_key_id = var.encryption == "KMS" ? local.website_kms_key_arn : null`',
  );
  await applyGritQL(
    tree,
    TERRAFORM_STATIC_WEBSITE_FILE,
    DISTRIBUTION_LOGS_ENCRYPTION_ALGO_LINE +
      ' => `sse_algorithm = var.encryption == "KMS" ? "aws:kms" : "AES256"`',
  );

  // 5. Make the WAF Web ACL conditional on enable_waf.
  await applyGritQL(
    tree,
    TERRAFORM_STATIC_WEBSITE_FILE,
    hcl(
      '`resource "aws_wafv2_web_acl" "cloudfront_waf" { $body }` => `resource "aws_wafv2_web_acl" "cloudfront_waf" {\n' +
        '  count = var.enable_waf ? 1 : 0\n\n' +
        '  $body\n' +
        '}`',
    ),
  );
  await applyGritQL(
    tree,
    TERRAFORM_STATIC_WEBSITE_FILE,
    WEB_ACL_ID_LINE +
      ' => `web_acl_id = var.enable_waf ? aws_wafv2_web_acl.cloudfront_waf[0].arn : null`',
  );
  await applyGritQL(
    tree,
    TERRAFORM_STATIC_WEBSITE_FILE,
    WAF_OUTPUT_VALUE_LINE +
      ' => `value = var.enable_waf ? aws_wafv2_web_acl.cloudfront_waf[0].arn : null`',
  );
};

const NEW_APP_MODULE_VARIABLES_TEXT = [
  'variable "custom_domain_names" {',
  '  description = "Custom domain names (aliases) for the CloudFront distribution. Requires acm_certificate_arn."',
  '  type        = list(string)',
  '  default     = []',
  '}',
  '',
  'variable "acm_certificate_arn" {',
  '  description = "ARN of an ACM certificate (in us-east-1) for the custom domain names. When set, viewers are required to use TLS 1.2 or later."',
  '  type        = string',
  '  default     = null',
  '}',
  '',
  'variable "enable_waf" {',
  '  description = "Whether to protect the CloudFront distribution with an AWS WAF Web ACL."',
  '  type        = bool',
  '  default     = true',
  '}',
  '',
  'variable "encryption" {',
  '  description = "Server-side encryption for the website and distribution log buckets. One of KMS or S3_MANAGED."',
  '  type        = string',
  '  default     = "KMS"',
  '',
  '  validation {',
  '    condition     = contains(["KMS", "S3_MANAGED"], var.encryption)',
  '    error_message = "encryption must be one of KMS or S3_MANAGED."',
  '  }',
  '}',
  '',
  'variable "kms_key_arn" {',
  '  description = "ARN of an existing KMS key used to encrypt the website and distribution log buckets when encryption is KMS. When not provided, a new key is created. Note that a customer-supplied key must already grant the CloudWatch Logs, S3 and CloudFront service principals the necessary permissions in its own key policy."',
  '  type        = string',
  '  default     = null',
  '}',
  '',
  'variable "enable_key_rotation" {',
  '  description = "Whether the automatically created KMS key has rotation enabled. Only applies when encryption is KMS and kms_key_arn is not provided."',
  '  type        = bool',
  '  default     = true',
  '}',
].join('\n');

const NEW_APP_MODULE_FORWARD_TEXT = [
  'custom_domain_names = var.custom_domain_names',
  'acm_certificate_arn = var.acm_certificate_arn',
  'enable_waf          = var.enable_waf',
  'encryption          = var.encryption',
  'kms_key_arn         = var.kms_key_arn',
  'enable_key_rotation = var.enable_key_rotation',
].join('\n  ');

/**
 * Surface the same configuration as pass-through variables on each vended
 * per-website Terraform app module, matching the pass-through convention
 * every other app-wraps-core Terraform module already follows.
 */
const migrateTerraformAppModules = async (
  tree: Tree,
  nextSteps: string[],
): Promise<void> => {
  if (!tree.exists(TERRAFORM_STATIC_WEBSITES_APP_DIR)) {
    return;
  }

  for (const dirName of tree.children(TERRAFORM_STATIC_WEBSITES_APP_DIR)) {
    const filePath = joinPathFragments(
      TERRAFORM_STATIC_WEBSITES_APP_DIR,
      dirName,
      `${dirName}.tf`,
    );
    if (!tree.exists(filePath)) {
      continue; // Not a website app module directory.
    }

    if (
      await matchGritQL(tree, filePath, hcl('`variable "enable_waf" { $_ }`'))
    ) {
      continue; // Already migrated.
    }

    const TERRAFORM_BLOCK = hcl('`terraform { $_ }`');
    const MODULE_BLOCK = hcl('`module "static_website" { $_ }`');
    const FILE_PATH_LINE = hcl(
      '`website_file_path = $val` as $line where {\n' +
        '  $line <: within `module "static_website" { $_ }`\n' +
        '}',
    );
    // custom_domain_names/acm_certificate_arn predate this migration as a
    // documented customization point (hand-editing the module block). If
    // either is already present as a literal argument, blindly forwarding
    // our own `= var.x` line would produce a duplicate argument, which is
    // invalid HCL. Treat that as diverged instead of silently corrupting the file.
    const hasExistingCustomDomainArg = async (name: string) =>
      matchGritQL(
        tree,
        filePath,
        hcl(
          `\`${name} = $_\` as $line where {\n` +
            '  $line <: within `module "static_website" { $_ }`\n' +
            '}',
        ),
      );

    const ready =
      (
        await Promise.all(
          [TERRAFORM_BLOCK, MODULE_BLOCK, FILE_PATH_LINE].map((pattern) =>
            matchGritQL(tree, filePath, pattern),
          ),
        )
      ).every(Boolean) &&
      !(await hasExistingCustomDomainArg('custom_domain_names')) &&
      !(await hasExistingCustomDomainArg('acm_certificate_arn'));

    if (!ready) {
      nextSteps.push(terraformAppDivergedMessage(filePath));
      continue;
    }

    // Inserted right after the terraform/required_providers block (and
    // before the "Static website module" comment), matching where the
    // vended template puts these variables.
    await insertViaGritQL(
      tree,
      filePath,
      hcl('`terraform { $body }` as $tf') +
        ` => \`$tf\n\n${GRIT_INSERT_PLACEHOLDER}\``,
      NEW_APP_MODULE_VARIABLES_TEXT,
    );

    await insertViaGritQL(
      tree,
      filePath,
      FILE_PATH_LINE + ` => \`$line\n\n  ${GRIT_INSERT_PLACEHOLDER}\``,
      NEW_APP_MODULE_FORWARD_TEXT,
    );
  }
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  await migrateCdkConstruct(tree, nextSteps);
  await migrateCdkAppConstructs(tree, nextSteps);
  await migrateTerraformModule(tree, nextSteps);
  await migrateTerraformAppModules(tree, nextSteps);

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
