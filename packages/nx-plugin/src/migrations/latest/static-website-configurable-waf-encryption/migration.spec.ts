/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { joinPathFragments } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import migration from './migration';

const CDK_FILE = 'packages/common/constructs/src/core/static-website.ts';
const APP_DIR = 'packages/common/constructs/src/app/static-websites';
const TF_FILE =
  'packages/common/terraform/src/core/static-website/static-website.tf';
const TF_APP_DIR = 'packages/common/terraform/src/app/static-websites';

const OLD_CDK_CONSTRUCT = `import {
  CfnOutput,
  CfnResource,
  Duration,
  Lazy,
  Names,
  RemovalPolicy,
  Stack,
} from 'aws-cdk-lib';
import {
  Distribution,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  ResponseHeadersPolicy,
  SecurityPolicyProtocol,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  IBucket,
  ObjectOwnership,
} from 'aws-cdk-lib/aws-s3';
import {
  BucketDeployment,
  CacheControl,
  Source,
} from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import { RuntimeConfig } from './runtime-config.js';
import { Key } from 'aws-cdk-lib/aws-kms';
import {
  CfnDelivery,
  CfnDeliveryDestination,
  CfnDeliverySource,
  LogGroup,
  RetentionDays,
} from 'aws-cdk-lib/aws-logs';
import { Effect, PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { CfnWebACL } from 'aws-cdk-lib/aws-wafv2';
import { suppressRules } from './checkov.js';

const DEFAULT_RUNTIME_CONFIG_FILENAME = 'runtime-config.json';

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
].join('; ');

export interface StaticWebsiteProps {
  readonly websiteName: string;
  readonly websiteFilePath: string;
  /**
   * Custom domain names for the CloudFront distribution. Requires \`certificate\`.
   */
  readonly domainNames?: string[];
  /**
   * ACM certificate for the custom domain names. Must be in us-east-1.
   * When provided, viewers are required to use TLS 1.2 or later.
   */
  readonly certificate?: ICertificate;
}

export class StaticWebsite extends Construct {
  public readonly websiteBucket: IBucket;
  public readonly cloudFrontDistribution: Distribution;
  public readonly bucketDeployment: BucketDeployment;

  constructor(
    scope: Construct,
    id: string,
    { websiteFilePath, websiteName, domainNames, certificate }: StaticWebsiteProps
  ) {
    super(scope, id);

    const websiteKey = new Key(this, 'WebsiteKey', {
      enableKeyRotation: true,
    });

    // Allow CloudWatch Logs to use the website key for server access log delivery.
    const stack = Stack.of(this);
    websiteKey.addToResourcePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        principals: [
          new ServicePrincipal(\`logs.\${stack.region}.amazonaws.com\`),
        ],
        actions: [
          'kms:Encrypt',
          'kms:Decrypt',
          'kms:ReEncrypt*',
          'kms:GenerateDataKey*',
          'kms:DescribeKey',
        ],
        resources: ['*'],
        conditions: {
          ArnLike: {
            'kms:EncryptionContext:aws:logs:arn': \`arn:aws:logs:\${stack.region}:\${stack.account}:log-group:*\`,
          },
        },
      }),
    );

    const accessLogs = new LogGroup(this, 'AccessLogs', {
      retention: RetentionDays.ONE_YEAR,
      encryptionKey: websiteKey,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // S3 Bucket to hold website files
    this.websiteBucket = new Bucket(this, 'WebsiteBucket', {
      versioned: true,
      enforceSSL: true,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
      encryption: BucketEncryption.KMS,
      encryptionKey: websiteKey,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      publicReadAccess: false,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    });
    suppressRules(
      this.websiteBucket,
      ['CKV_AWS_18'],
      'Server access logs are delivered to CloudWatch Logs',
    );
    this.deliverAccessLogsToCloudWatch(
      'Website',
      this.websiteBucket,
      accessLogs,
    );
    // Web ACL
    const wafStack = new CloudfrontWebAcl(this, 'waf');

    // Bucket holding CloudFront standard access logs. CloudFront delivers its
    // own logs to S3 only, so this bucket is retained; its S3 server access
    // logs are delivered to CloudWatch Logs.
    const logBucket = new Bucket(this, 'DistributionLogBucket', {
      enforceSSL: true,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
      encryption: BucketEncryption.KMS,
      encryptionKey: websiteKey,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_PREFERRED,
      publicReadAccess: false,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    });
    suppressRules(
      logBucket,
      ['CKV_AWS_21'],
      'Distribution log bucket does not need versioning enabled',
    );
    suppressRules(
      logBucket,
      ['CKV_AWS_18'],
      'Server access logs are delivered to CloudWatch Logs',
    );
    this.deliverAccessLogsToCloudWatch('Distribution', logBucket, accessLogs);

    const defaultRootObject = 'index.html';
    this.cloudFrontDistribution = new Distribution(
      this,
      'CloudfrontDistribution',
      {
        webAclId: wafStack.wafArn,
        enableLogging: true,
        logBucket: logBucket,
        ...(certificate
          ? {
              certificate,
              domainNames,
              minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
            }
          : {}),
        defaultBehavior: {
          origin: S3BucketOrigin.withOriginAccessControl(this.websiteBucket),
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          responseHeadersPolicy: undefined as unknown as ResponseHeadersPolicy,
        },
        defaultRootObject,
      },
    );
    if (!certificate) {
      suppressRules(
        this.cloudFrontDistribution,
        ['CKV_AWS_174'],
        'Cloudfront default certificate does not use TLS 1.2',
      );
    }

    this.bucketDeployment = new BucketDeployment(this, 'WebsiteDeployment', {
      sources: [Source.asset(websiteFilePath)],
      destinationBucket: this.websiteBucket,
      distribution: this.cloudFrontDistribution,
      exclude: [DEFAULT_RUNTIME_CONFIG_FILENAME],
      memoryLimit: 1024,
    });

    new CfnOutput(this, 'DistributionDomainName', {
      value: this.cloudFrontDistribution.domainName,
    });
    new CfnOutput(this, \`\${websiteName}WebsiteBucketName\`, {
      value: this.websiteBucket.bucketName,
    });
  }

  private deliverAccessLogsToCloudWatch(
    id: string,
    bucket: IBucket,
    logGroup: LogGroup,
  ) {
    const source: CfnDeliverySource = new CfnDeliverySource(
      this,
      \`\${id}AccessLogsSource\`,
      {
        name: Lazy.string({
          produce: () => Names.uniqueResourceName(source, { maxLength: 60 }),
        }),
        logType: 'S3_SERVER_ACCESS_LOGS',
        resourceArn: bucket.bucketArn,
      },
    );
    const bucketPolicy = (bucket as Bucket).policy;
    if (bucketPolicy) {
      source.node.addDependency(bucketPolicy);
    }
    const destination: CfnDeliveryDestination = new CfnDeliveryDestination(
      this,
      \`\${id}AccessLogsDestination\`,
      {
        name: Lazy.string({
          produce: () => Names.uniqueResourceName(destination, { maxLength: 60 }),
        }),
        destinationResourceArn: logGroup.logGroupArn,
      },
    );
    const delivery = new CfnDelivery(this, \`\${id}AccessLogsDelivery\`, {
      deliverySourceName: source.name,
      deliveryDestinationArn: destination.attrArn,
    });
    delivery.addDependency(source);
  }
}

export class CloudfrontWebAcl extends Stack {
  public readonly wafArn;
  constructor(scope: Construct, id: string) {
    super(scope, id, {
      env: {
        region: 'us-east-1',
        account: Stack.of(scope).account,
      },
      crossRegionReferences: true,
    });

    this.wafArn = new CfnWebACL(this, 'WebAcl', {
      defaultAction: { allow: {} },
      scope: 'CLOUDFRONT',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: id,
        sampledRequestsEnabled: true,
      },
      rules: [],
    }).attrArn;
  }
}
`;

const oldAppConstruct = (name: string) => `import * as url from 'url';
import { Construct } from 'constructs';
import { StaticWebsite } from '../../core/index.js';

export class ${name} extends StaticWebsite {
  constructor(scope: Construct, id: string) {
    super(scope, id, {
      websiteName: '${name}',
      websiteFilePath: url.fileURLToPath(
        new URL('../../../../../../apps/${name.toLowerCase()}/bundle', import.meta.url)
      ),
    });
  }
}
`;

// The pre-existing documented customization point (before this migration
// added props pass-through): hand-editing the super() call to add
// domainNames/certificate directly in the generated construct.
const oldAppConstructWithCustomDomain = (
  name: string,
) => `import * as url from 'url';
import { Construct } from 'constructs';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { StaticWebsite } from '../../core/index.js';

export class ${name} extends StaticWebsite {
  constructor(scope: Construct, id: string) {
    super(scope, id, {
      websiteName: '${name}',
      websiteFilePath: url.fileURLToPath(
        new URL('../../../../../../apps/${name.toLowerCase()}/bundle', import.meta.url)
      ),
      domainNames: ['www.example.com'],
      certificate: Certificate.fromCertificateArn(this, 'Cert',
        'arn:aws:acm:us-east-1:123456789012:certificate/...'),
    });
  }
}
`;

const OLD_TERRAFORM_MODULE = `terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
      configuration_aliases = [aws.us_east_1]
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

# Variables
variable "website_name" {
  description = "Name of the website"
  type        = string
}

variable "website_file_path" {
  description = "Path to the website files"
  type        = string
}

variable "custom_domain_names" {
  description = "Custom domain names (aliases) for the CloudFront distribution. Requires acm_certificate_arn."
  type        = list(string)
  default     = []
}

variable "acm_certificate_arn" {
  description = "ARN of an ACM certificate (in us-east-1) for the custom domain names. When set, viewers are required to use TLS 1.2 or later."
  type        = string
  default     = null
}

locals {
  content_security_policy = "default-src 'self'"

  # Delivery source/destination names have a 60 character maximum. Truncate the
  # website name so the longest delivery name stays within the limit.
  access_logs_name_prefix = substr(lower(var.website_name), 0, 16)
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

resource "aws_kms_key" "website_key" {
  description             = "KMS key for \${var.website_name} website encryption"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "Enable IAM User Permissions"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::\${data.aws_caller_identity.current.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      }
    ]
  })

  tags = {
    Name = "\${lower(var.website_name)}-website-key-\${random_id.unique_suffix.hex}"
  }
}

resource "aws_kms_alias" "website_key_alias" {
  name          = "alias/\${lower(var.website_name)}-website-key-\${random_id.unique_suffix.hex}"
  target_key_id = aws_kms_key.website_key.key_id
}

resource "aws_cloudwatch_log_group" "access_logs" {
  name              = "/aws/s3/\${lower(var.website_name)}-access-logs-\${random_id.bucket_suffix.hex}"
  retention_in_days = 365
  kms_key_id        = aws_kms_key.website_key.arn
}

resource "random_id" "unique_suffix" {
  byte_length = 4
}

resource "random_id" "bucket_suffix" {
  byte_length = 8
}

resource "aws_s3_bucket" "website" {
  bucket        = "\${lower(var.website_name)}-website-\${random_id.bucket_suffix.hex}"
  force_destroy = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "website_encryption" {
  bucket = aws_s3_bucket.website.id

  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.website_key.arn
      sse_algorithm     = "aws:kms"
    }
  }
}

resource "aws_s3_bucket" "distribution_logs" {
  bucket        = "\${lower(var.website_name)}-distribution-logs-\${random_id.bucket_suffix.hex}"
  force_destroy = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "distribution_logs_encryption" {
  bucket = aws_s3_bucket.distribution_logs.id

  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.website_key.arn
      sse_algorithm     = "aws:kms"
    }
  }
}

resource "aws_wafv2_web_acl" "cloudfront_waf" {
  provider = aws.us_east_1
  name     = "\${lower(var.website_name)}-cloudfront-waf-\${random_id.unique_suffix.hex}"
  scope    = "CLOUDFRONT"

  default_action {
    allow {}
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                 = "\${lower(var.website_name)}-waf"
    sampled_requests_enabled    = true
  }
}

resource "aws_cloudfront_distribution" "website" {
  origin {
    domain_name              = aws_s3_bucket.website.bucket_regional_domain_name
    origin_id                = "S3-\${aws_s3_bucket.website.bucket}"
  }

  enabled             = true
  default_root_object = "index.html"
  web_acl_id          = aws_wafv2_web_acl.cloudfront_waf.arn
  aliases             = var.custom_domain_names

  lifecycle {
    replace_triggered_by = [
      aws_wafv2_web_acl.cloudfront_waf
    ]
  }
}

output "cloudfront_domain_name" {
  description = "Domain name of the CloudFront distribution"
  value       = aws_cloudfront_distribution.website.domain_name
}

output "waf_web_acl_arn" {
  description = "ARN of the WAF Web ACL"
  value       = aws_wafv2_web_acl.cloudfront_waf.arn
}
`;

const oldTerraformAppModule = (name: string) => `terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
      configuration_aliases = [aws.us_east_1]
    }
  }
}

# Static website module configured for the web package
module "static_website" {
  source = "../../../core/static-website"

  website_name      = "${name}"
  website_file_path = "\${path.module}/../../../../../../../apps/${name}/bundle"

  providers = {
    aws.us_east_1 = aws.us_east_1
  }
}

# Outputs
output "website_url" {
  description = "URL of the deployed website"
  value       = "https://\${module.static_website.cloudfront_domain_name}"
}

output "website_bucket_name" {
  description = "Name of the S3 bucket hosting the website"
  value       = module.static_website.website_bucket_name
}

output "cloudfront_distribution_id" {
  description = "ID of the CloudFront distribution"
  value       = module.static_website.cloudfront_distribution_id
}

output "cloudfront_domain_name" {
  description = "Domain name of the CloudFront distribution"
  value       = module.static_website.cloudfront_domain_name
}
`;

// custom_domain_names/acm_certificate_arn predate this migration as a
// documented customization point (hand-editing the module block directly).
const oldTerraformAppModuleWithCustomDomain = (name: string) => `terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
      configuration_aliases = [aws.us_east_1]
    }
  }
}

# Static website module configured for the web package
module "static_website" {
  source = "../../../core/static-website"

  website_name      = "${name}"
  website_file_path = "\${path.module}/../../../../../../../apps/${name}/bundle"
  custom_domain_names = ["www.example.com"]
  acm_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/..."

  providers = {
    aws.us_east_1 = aws.us_east_1
  }
}
`;

describe('static-website-configurable-waf-encryption migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  describe('CDK construct', () => {
    it('does nothing when the file does not exist', async () => {
      const result = await migration(tree);
      expect(result.nextSteps).toEqual([]);
    });

    it('surfaces enableWaf/encryption/encryptionKey/enableKeyRotation on the vended shape', async () => {
      tree.write(CDK_FILE, OLD_CDK_CONSTRUCT);

      const result = await migration(tree);

      const migrated = tree.read(CDK_FILE, 'utf-8')!;
      expect(migrated).toMatch(
        /import \{ (IKey, Key|Key, IKey) \} from 'aws-cdk-lib\/aws-kms'/,
      );
      expect(migrated).not.toContain(
        "import { Key } from 'aws-cdk-lib/aws-kms'",
      );
      expect(migrated).toContain('readonly enableWaf?: boolean');
      expect(migrated).toContain('readonly encryption?: BucketEncryption');
      expect(migrated).toContain('readonly encryptionKey?: IKey');
      expect(migrated).toContain('readonly enableKeyRotation?: boolean');
      expect(migrated).toContain('enableWaf = true');
      expect(migrated).toContain('encryption = BucketEncryption.KMS');
      expect(migrated).toContain('enableKeyRotation = true');
      expect(migrated).toContain('encryption === BucketEncryption.KMS');
      expect(migrated).toContain(
        "encryptionKey ?? new Key(this, 'WebsiteKey', { enableKeyRotation })",
      );
      expect(migrated).toContain('websiteKey?.addToResourcePolicy(');
      expect(migrated).not.toContain('websiteKey.addToResourcePolicy(');
      expect(migrated).not.toContain('encryption: BucketEncryption.KMS');
      expect(migrated).toContain(
        "const wafStack = enableWaf ? new CloudfrontWebAcl(this, 'waf') : undefined",
      );
      expect(migrated).toContain('webAclId: wafStack?.wafArn');
      expect(result.nextSteps).toEqual([]);
    });

    it('is idempotent', async () => {
      tree.write(CDK_FILE, OLD_CDK_CONSTRUCT);
      await migration(tree);
      const migratedOnce = tree.read(CDK_FILE, 'utf-8');

      const result = await migration(tree);

      expect(tree.read(CDK_FILE, 'utf-8')).toEqual(migratedOnce);
      expect(result.nextSteps).toEqual([]);
    });

    it('skips and reports a diverged construct', async () => {
      tree.write(
        CDK_FILE,
        OLD_CDK_CONSTRUCT.replace(
          "const wafStack = new CloudfrontWebAcl(this, 'waf');",
          "const wafStack = new CloudfrontWebAcl(this, 'my-custom-waf');",
        ),
      );

      const result = await migration(tree);

      expect(tree.read(CDK_FILE, 'utf-8')).toContain(
        "new CloudfrontWebAcl(this, 'my-custom-waf')",
      );
      expect(result.nextSteps.some((step) => step.includes(CDK_FILE))).toBe(
        true,
      );
    });
  });

  describe('CDK app constructs', () => {
    it('adds an optional props parameter to each vended website construct', async () => {
      tree.write(CDK_FILE, OLD_CDK_CONSTRUCT);
      tree.write(
        joinPathFragments(APP_DIR, 'my-website.ts'),
        oldAppConstruct('MyWebsite'),
      );
      tree.write(
        joinPathFragments(APP_DIR, 'index.ts'),
        `export * from './my-website.js';\n`,
      );

      const result = await migration(tree);

      const migrated = tree.read(
        joinPathFragments(APP_DIR, 'my-website.ts'),
        'utf-8',
      )!;
      expect(migrated).toContain(
        "import { StaticWebsite, StaticWebsiteProps } from '../../core/index.js'",
      );
      expect(migrated).toContain(
        "export type MyWebsiteProps = Omit<\n  StaticWebsiteProps,\n  'websiteName' | 'websiteFilePath'\n>;",
      );
      expect(migrated).toContain(
        'constructor(scope: Construct, id: string, props?: MyWebsiteProps)',
      );
      expect(migrated).toContain("...props,\n      websiteName: 'MyWebsite',");
      expect(result.nextSteps).toEqual([]);
    });

    it('preserves a pre-existing domainNames/certificate customization', async () => {
      const appFile = joinPathFragments(APP_DIR, 'my-website.ts');
      tree.write(appFile, oldAppConstructWithCustomDomain('MyWebsite'));

      const result = await migration(tree);

      const migrated = tree.read(appFile, 'utf-8')!;
      expect(migrated).toContain("domainNames: ['www.example.com']");
      expect(migrated).toContain('Certificate.fromCertificateArn');
      expect(migrated).toContain(
        'constructor(scope: Construct, id: string, props?: MyWebsiteProps)',
      );
      expect(migrated).toContain('...props,');
      expect(result.nextSteps).toEqual([]);
    });

    it('is idempotent', async () => {
      tree.write(CDK_FILE, OLD_CDK_CONSTRUCT);
      const appFile = joinPathFragments(APP_DIR, 'my-website.ts');
      tree.write(appFile, oldAppConstruct('MyWebsite'));

      await migration(tree);
      const migratedOnce = tree.read(appFile, 'utf-8');

      const result = await migration(tree);

      expect(tree.read(appFile, 'utf-8')).toEqual(migratedOnce);
      expect(result.nextSteps).toEqual([]);
    });

    it('skips and reports a diverged app construct', async () => {
      const appFile = joinPathFragments(APP_DIR, 'my-website.ts');
      tree.write(
        appFile,
        oldAppConstruct('MyWebsite').replace(
          'constructor(scope: Construct, id: string) {',
          'constructor(scope: Construct, id: string, extra: string) {',
        ),
      );

      const result = await migration(tree);

      expect(tree.read(appFile, 'utf-8')).toContain('extra: string');
      expect(result.nextSteps.some((step) => step.includes(appFile))).toBe(
        true,
      );
    });

    it('leaves non-StaticWebsite files in the directory untouched', async () => {
      const helperFile = joinPathFragments(APP_DIR, 'helpers.ts');
      tree.write(helperFile, `export const helper = () => 1;\n`);

      const result = await migration(tree);

      expect(tree.read(helperFile, 'utf-8')).toEqual(
        `export const helper = () => 1;\n`,
      );
      expect(result.nextSteps).toEqual([]);
    });
  });

  describe('Terraform module', () => {
    it('surfaces enable_waf/encryption/kms_key_arn/enable_key_rotation on the vended shape', async () => {
      tree.write(TF_FILE, OLD_TERRAFORM_MODULE);

      const result = await migration(tree);

      const migrated = tree.read(TF_FILE, 'utf-8')!;
      expect(migrated).toContain('variable "enable_waf"');
      expect(migrated).toContain('variable "encryption"');
      expect(migrated).toContain('variable "kms_key_arn"');
      expect(migrated).toContain('variable "enable_key_rotation"');
      expect(migrated).toContain('create_website_key');
      expect(migrated).toContain('website_kms_key_arn');
      expect(migrated).toContain('count = local.create_website_key ? 1 : 0');
      expect(migrated).toContain(
        'enable_key_rotation = var.enable_key_rotation',
      );
      expect(migrated).toContain(
        'target_key_id = aws_kms_key.website_key[0].key_id',
      );
      expect(migrated).toContain('kms_key_id = local.website_kms_key_arn');
      expect(migrated).toContain(
        'kms_master_key_id = var.encryption == "KMS" ? local.website_kms_key_arn : null',
      );
      expect(migrated).toContain(
        'sse_algorithm = var.encryption == "KMS" ? "aws:kms" : "AES256"',
      );
      expect(migrated).toContain('count = var.enable_waf ? 1 : 0');
      expect(migrated).toContain(
        'web_acl_id = var.enable_waf ? aws_wafv2_web_acl.cloudfront_waf[0].arn : null',
      );
      expect(migrated).toContain(
        'value = var.enable_waf ? aws_wafv2_web_acl.cloudfront_waf[0].arn : null',
      );
      expect(migrated).not.toContain('aws_kms_key.website_key.arn');
      expect(migrated).not.toContain('aws_kms_key.website_key.key_id');
      expect(migrated).not.toContain('aws_wafv2_web_acl.cloudfront_waf.arn');
      expect(result.nextSteps).toEqual([]);
    });

    it('is idempotent', async () => {
      tree.write(TF_FILE, OLD_TERRAFORM_MODULE);
      await migration(tree);
      const migratedOnce = tree.read(TF_FILE, 'utf-8');

      const result = await migration(tree);

      expect(tree.read(TF_FILE, 'utf-8')).toEqual(migratedOnce);
      expect(result.nextSteps).toEqual([]);
    });

    it('skips and reports a diverged module', async () => {
      tree.write(
        TF_FILE,
        OLD_TERRAFORM_MODULE.replace(
          'resource "aws_kms_alias" "website_key_alias"',
          'resource "aws_kms_alias" "my_custom_alias"',
        ),
      );

      const result = await migration(tree);

      expect(tree.read(TF_FILE, 'utf-8')).toContain(
        'resource "aws_kms_alias" "my_custom_alias"',
      );
      expect(result.nextSteps.some((step) => step.includes(TF_FILE))).toBe(
        true,
      );
    });
  });

  describe('Terraform app module', () => {
    it('adds pass-through variables to each vended website app module', async () => {
      const appFile = joinPathFragments(
        TF_APP_DIR,
        'my-website',
        'my-website.tf',
      );
      tree.write(appFile, oldTerraformAppModule('my-website'));

      const result = await migration(tree);

      const migrated = tree.read(appFile, 'utf-8')!;
      expect(migrated).toContain('variable "custom_domain_names"');
      expect(migrated).toContain('variable "acm_certificate_arn"');
      expect(migrated).toContain('variable "enable_waf"');
      expect(migrated).toContain('variable "encryption"');
      expect(migrated).toContain('variable "kms_key_arn"');
      expect(migrated).toContain('variable "enable_key_rotation"');
      expect(migrated).toContain(
        'custom_domain_names = var.custom_domain_names',
      );
      expect(migrated).toContain(
        'acm_certificate_arn = var.acm_certificate_arn',
      );
      expect(migrated).toContain('enable_waf          = var.enable_waf');
      expect(migrated).toContain('encryption          = var.encryption');
      expect(migrated).toContain('kms_key_arn         = var.kms_key_arn');
      expect(migrated).toContain(
        'enable_key_rotation = var.enable_key_rotation',
      );
      expect(result.nextSteps).toEqual([]);
    });

    it('skips and reports rather than duplicating a pre-existing custom_domain_names argument', async () => {
      const appFile = joinPathFragments(
        TF_APP_DIR,
        'my-website',
        'my-website.tf',
      );
      tree.write(appFile, oldTerraformAppModuleWithCustomDomain('my-website'));

      const result = await migration(tree);

      const migrated = tree.read(appFile, 'utf-8')!;
      const customDomainCount = (
        migrated.match(/custom_domain_names\s*=/g) ?? []
      ).length;
      const certArnCount = (migrated.match(/acm_certificate_arn\s*=/g) ?? [])
        .length;
      expect(customDomainCount).toBe(1);
      expect(certArnCount).toBe(1);
      expect(migrated).toContain('custom_domain_names = ["www.example.com"]');
      expect(result.nextSteps.some((step) => step.includes(appFile))).toBe(
        true,
      );
    });

    it('is idempotent', async () => {
      const appFile = joinPathFragments(
        TF_APP_DIR,
        'my-website',
        'my-website.tf',
      );
      tree.write(appFile, oldTerraformAppModule('my-website'));

      await migration(tree);
      const migratedOnce = tree.read(appFile, 'utf-8');

      const result = await migration(tree);

      expect(tree.read(appFile, 'utf-8')).toEqual(migratedOnce);
      expect(result.nextSteps).toEqual([]);
    });

    it('skips and reports a diverged app module', async () => {
      const appFile = joinPathFragments(
        TF_APP_DIR,
        'my-website',
        'my-website.tf',
      );
      tree.write(
        appFile,
        oldTerraformAppModule('my-website').replace(
          'module "static_website" {',
          'module "my_custom_website" {',
        ),
      );

      const result = await migration(tree);

      expect(tree.read(appFile, 'utf-8')).toContain(
        'module "my_custom_website" {',
      );
      expect(result.nextSteps.some((step) => step.includes(appFile))).toBe(
        true,
      );
    });

    it('handles multiple website app modules independently', async () => {
      const fooFile = joinPathFragments(TF_APP_DIR, 'foo', 'foo.tf');
      const barFile = joinPathFragments(TF_APP_DIR, 'bar', 'bar.tf');
      tree.write(fooFile, oldTerraformAppModule('foo'));
      tree.write(barFile, oldTerraformAppModule('bar'));

      const result = await migration(tree);

      expect(tree.read(fooFile, 'utf-8')).toContain('variable "enable_waf"');
      expect(tree.read(barFile, 'utf-8')).toContain('variable "enable_waf"');
      expect(result.nextSteps).toEqual([]);
    });
  });
});
