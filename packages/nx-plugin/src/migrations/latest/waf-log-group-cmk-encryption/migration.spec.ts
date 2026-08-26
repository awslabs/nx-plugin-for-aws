/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const TERRAFORM_REST_API_FILE =
  'packages/common/terraform/src/core/api/rest/rest-api/rest-api.tf';
const TERRAFORM_USER_IDENTITY_FILE =
  'packages/common/terraform/src/core/user-identity/identity/identity.tf';
const TERRAFORM_GATEWAY_FILE =
  'packages/common/terraform/src/app/gateways/my-gateway/my-gateway.tf';
const CDK_USER_IDENTITY_FILE =
  'packages/common/constructs/src/core/user-identity.ts';

/**
 * The core REST API module's WAF logging block as generated before the log group
 * was encrypted, condensed to the shape the migration anchors on.
 */
const OLD_TERRAFORM_REST_API_FILE = `data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  existing = "untouched"
}

# CloudWatch Log Group for WAF request logs. Name must start with \`aws-waf-logs-\`.
resource "aws_cloudwatch_log_group" "api_waf_logs" {
  #checkov:skip=CKV_AWS_158:Using default CloudWatch log encryption
  #checkov:skip=CKV_AWS_338:Log retention set to one month which is sufficient for WAF logs
  count = var.enable_waf ? 1 : 0

  name              = "aws-waf-logs-\${var.api_name}-\${random_id.waf_log_suffix[0].hex}"
  retention_in_days = 30
  tags              = var.tags
}

resource "random_id" "waf_log_suffix" {
  count       = var.enable_waf ? 1 : 0
  byte_length = 4
}
`;

/** The user identity module's WAF logging block, before encryption. */
const OLD_TERRAFORM_USER_IDENTITY_FILE = `data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  local_callback_urls = [
    "http://localhost:4200"
  ]
}

resource "random_id" "unique_suffix" {
  byte_length = 4
}

# CloudWatch Log Group for WAF request logs. Name must start with \`aws-waf-logs-\`.
resource "aws_cloudwatch_log_group" "user_pool_waf_logs" {
  #checkov:skip=CKV_AWS_158:Using default CloudWatch log encryption
  #checkov:skip=CKV_AWS_338:Log retention set to one month which is sufficient for WAF logs
  count = var.enable_waf ? 1 : 0

  name              = "aws-waf-logs-UserPool-\${random_id.unique_suffix.hex}"
  retention_in_days = 30
}
`;

/**
 * The gateway app module's WAF logging block, before encryption. This module
 * reaches the account id and region through locals rather than the data sources
 * directly, which the key policy this migration writes must follow.
 */
const OLD_TERRAFORM_GATEWAY_FILE = `data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  aws_account_id = data.aws_caller_identity.current.account_id
  aws_region     = data.aws_region.current.id
}

resource "random_id" "unique_suffix" {
  byte_length = 4
}

# WAF request logs. WAFv2 requires the \`aws-waf-logs-\` name prefix.
resource "aws_cloudwatch_log_group" "gateway_waf_logs" {
  #checkov:skip=CKV_AWS_158:Using default CloudWatch log encryption
  #checkov:skip=CKV_AWS_338:Log retention set to one year which is sufficient for WAF logs
  count = var.enable_waf ? 1 : 0

  name              = "aws-waf-logs-my-gateway-\${random_id.unique_suffix.hex}"
  retention_in_days = 365
}
`;

/** The CDK user identity construct's WAF log group, before encryption. */
const OLD_CDK_USER_IDENTITY_FILE = `import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import { CfnLoggingConfiguration, CfnWebACL } from 'aws-cdk-lib/aws-wafv2';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { suppressRules } from './checkov.js';

export class UserIdentity extends Construct {
  private createWebAcl = (id: string) => {
    const webAcl = new CfnWebACL(this, 'WebAcl', {});

    // Send WAF request logs to CloudWatch. The log group name must start with
    // \`aws-waf-logs-\` to satisfy the WAFv2 logging destination requirement.
    const wafLogGroup = new LogGroup(this, 'WebAclLogs', {
      logGroupName: \`aws-waf-logs-\${id}-\${this.node.addr.slice(-8)}\`,
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    suppressRules(
      wafLogGroup,
      ['CKV_AWS_158'],
      'Using default CloudWatch log encryption for WAF logs',
    );

    new CfnLoggingConfiguration(this, 'WebAclLoggingConfig', {
      resourceArn: webAcl.attrArn,
      logDestinationConfigs: [wafLogGroup.logGroupArn],
    });

    return webAcl;
  };
}
`;

describe('waf-log-group-cmk-encryption migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should do nothing when nothing is vended', async () => {
    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
  });

  it('should encrypt the terraform rest api WAF log group', async () => {
    tree.write(TERRAFORM_REST_API_FILE, OLD_TERRAFORM_REST_API_FILE);

    const result = await migration(tree);

    const contents = tree.read(TERRAFORM_REST_API_FILE, 'utf-8')!;
    expect(contents).toContain(
      'kms_key_id        = aws_kms_key.waf_logs[0].arn',
    );
    expect(contents).toContain('resource "aws_kms_key" "waf_logs"');
    expect(contents).toContain('resource "aws_kms_alias" "waf_logs"');
    // The name moves into a local so the key policy can name the same log group.
    expect(contents).toContain('name              = local.waf_log_group_name');
    expect(contents).toContain(
      '"kms:EncryptionContext:aws:logs:arn" = "arn:aws:logs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:log-group:${local.waf_log_group_name}"',
    );
    // The suppression the encryption makes redundant is dropped.
    expect(contents).not.toContain('CKV_AWS_158');
    // The unrelated retention suppression stays.
    expect(contents).toContain('CKV_AWS_338');
    // Pre-existing locals are preserved.
    expect(contents).toContain('existing = "untouched"');
    expect(contents).not.toContain('GRIT_INSERT_PLACEHOLDER');
    expect(result.nextSteps).toEqual([]);
    expect(contents).toMatchSnapshot();
  });

  it('should encrypt the terraform user identity WAF log group', async () => {
    tree.write(TERRAFORM_USER_IDENTITY_FILE, OLD_TERRAFORM_USER_IDENTITY_FILE);

    const result = await migration(tree);

    const contents = tree.read(TERRAFORM_USER_IDENTITY_FILE, 'utf-8')!;
    expect(contents).toContain(
      'kms_key_id        = aws_kms_key.user_pool_waf_logs[0].arn',
    );
    expect(contents).toContain(
      'name              = local.user_pool_waf_log_group_name',
    );
    // This module tags nothing, so neither does the key it gains.
    expect(contents).not.toContain('tags = var.tags');
    expect(contents).not.toContain('CKV_AWS_158');
    expect(contents).toContain('local_callback_urls');
    expect(result.nextSteps).toEqual([]);
    expect(contents).toMatchSnapshot();
  });

  it('should encrypt the terraform gateway WAF log group via the module locals', async () => {
    tree.write(TERRAFORM_GATEWAY_FILE, OLD_TERRAFORM_GATEWAY_FILE);

    const result = await migration(tree);

    const contents = tree.read(TERRAFORM_GATEWAY_FILE, 'utf-8')!;
    expect(contents).toContain(
      'kms_key_id        = aws_kms_key.gateway_waf_logs[0].arn',
    );
    // This module reaches the account and region through locals.
    expect(contents).toContain(
      'Principal = { Service = "logs.${local.aws_region}.amazonaws.com" }',
    );
    expect(contents).toContain(
      'Principal = { AWS = "arn:aws:iam::${local.aws_account_id}:root" }',
    );
    expect(contents).toContain(
      'name          = "alias/my-gateway-${random_id.unique_suffix.hex}-waf-logs"',
    );
    expect(contents).not.toContain('CKV_AWS_158');
    expect(result.nextSteps).toEqual([]);
    expect(contents).toMatchSnapshot();
  });

  it('should encrypt the cdk user identity WAF log group', async () => {
    tree.write(CDK_USER_IDENTITY_FILE, OLD_CDK_USER_IDENTITY_FILE);

    const result = await migration(tree);

    const contents = tree.read(CDK_USER_IDENTITY_FILE, 'utf-8')!;
    expect(contents).toContain('encryptionKey: logsKey');
    expect(contents).toContain("new Key(this, 'WebAclLogsKey'");
    expect(contents).toMatch(
      /import \{[^}]*Key[^}]*\} from 'aws-cdk-lib\/aws-kms'/,
    );
    expect(contents).toMatch(
      /import \{[^}]*PolicyStatement[^}]*\} from 'aws-cdk-lib\/aws-iam'/,
    );
    // The key policy grant is scoped to this log group by encryption context.
    expect(contents).toContain("'kms:EncryptionContext:aws:logs:arn'");
    expect(contents).toContain('logGroupName: wafLogGroupName');
    // The suppression the encryption makes redundant is dropped.
    expect(contents).not.toContain('CKV_AWS_158');
    expect(contents).not.toContain('GRIT_INSERT_PLACEHOLDER');
    expect(result.nextSteps).toEqual([]);
    expect(contents).toMatchSnapshot();
  });

  it('should be idempotent', async () => {
    tree.write(TERRAFORM_REST_API_FILE, OLD_TERRAFORM_REST_API_FILE);
    tree.write(TERRAFORM_USER_IDENTITY_FILE, OLD_TERRAFORM_USER_IDENTITY_FILE);
    tree.write(TERRAFORM_GATEWAY_FILE, OLD_TERRAFORM_GATEWAY_FILE);
    tree.write(CDK_USER_IDENTITY_FILE, OLD_CDK_USER_IDENTITY_FILE);

    await migration(tree);
    const files = [
      TERRAFORM_REST_API_FILE,
      TERRAFORM_USER_IDENTITY_FILE,
      TERRAFORM_GATEWAY_FILE,
      CDK_USER_IDENTITY_FILE,
    ];
    const afterFirst = files.map((file) => tree.read(file, 'utf-8')!);

    const secondRun = await migration(tree);

    expect(files.map((file) => tree.read(file, 'utf-8'))).toEqual(afterFirst);
    expect(secondRun.nextSteps).toEqual([]);
    // Exactly one key per log group, not one per run.
    expect(afterFirst[0].match(/resource "aws_kms_key"/g)).toHaveLength(1);
    expect(afterFirst[3].match(/WebAclLogsKey/g)).toHaveLength(1);
  });

  it('should leave an already-encrypted terraform log group alone', async () => {
    const alreadyEncrypted = OLD_TERRAFORM_REST_API_FILE.replace(
      'retention_in_days = 30',
      'retention_in_days = 30\n  kms_key_id        = aws_kms_key.waf_logs[0].arn',
    );
    tree.write(TERRAFORM_REST_API_FILE, alreadyEncrypted);

    const result = await migration(tree);

    expect(tree.read(TERRAFORM_REST_API_FILE, 'utf-8')).toEqual(
      alreadyEncrypted,
    );
    expect(result.nextSteps).toEqual([]);
  });

  it('should leave an already-encrypted cdk log group alone', async () => {
    tree.write(
      CDK_USER_IDENTITY_FILE,
      OLD_CDK_USER_IDENTITY_FILE.replace(
        'retention: RetentionDays.ONE_MONTH,',
        'retention: RetentionDays.ONE_MONTH,\n      encryptionKey: myOwnKey,',
      ),
    );

    const result = await migration(tree);

    const contents = tree.read(CDK_USER_IDENTITY_FILE, 'utf-8')!;
    expect(contents).toContain('encryptionKey: myOwnKey');
    expect(contents).not.toContain('WebAclLogsKey');
    expect(result.nextSteps).toEqual([]);
  });

  it('should report a diverged terraform log group rather than rewriting it', async () => {
    tree.write(
      TERRAFORM_REST_API_FILE,
      `locals {}

resource "aws_cloudwatch_log_group" "api_waf_logs" {
  #checkov:skip=CKV_AWS_158:Using default CloudWatch log encryption
  count = var.enable_waf ? 1 : 0

  name              = "aws-waf-logs-\${var.api_name}-hand-edited"
  retention_in_days = 30
}
`,
    );

    const result = await migration(tree);

    const contents = tree.read(TERRAFORM_REST_API_FILE, 'utf-8')!;
    expect(contents).toContain('hand-edited');
    expect(contents).not.toContain('aws_kms_key');
    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps![0]).toContain(TERRAFORM_REST_API_FILE);
  });

  it('should report a diverged cdk log group rather than rewriting it', async () => {
    tree.write(
      CDK_USER_IDENTITY_FILE,
      `import { LogGroup } from 'aws-cdk-lib/aws-logs';

export class UserIdentity {
  private createWebAcl = (id: string) => {
    const wafLogGroup = new LogGroup(this, 'WebAclLogs', {
      logGroupName: \`aws-waf-logs-\${id}-hand-edited\`,
    });
  };
}
`,
    );

    const result = await migration(tree);

    const contents = tree.read(CDK_USER_IDENTITY_FILE, 'utf-8')!;
    expect(contents).toContain('hand-edited');
    expect(contents).not.toContain('WebAclLogsKey');
    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps![0]).toContain(CDK_USER_IDENTITY_FILE);
  });

  it('should do nothing when WAF is disabled so no log group is vended', async () => {
    tree.write(
      TERRAFORM_REST_API_FILE,
      `locals {}\n\nresource "aws_api_gateway_rest_api" "rest_api" {}\n`,
    );
    tree.write(
      CDK_USER_IDENTITY_FILE,
      `export class UserIdentity { /* waf disabled, no web acl */ }`,
    );

    const result = await migration(tree);

    expect(tree.read(CDK_USER_IDENTITY_FILE, 'utf-8')).toContain(
      'waf disabled',
    );
    expect(result.nextSteps).toEqual([]);
  });
});
