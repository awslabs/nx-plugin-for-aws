/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import migration from './migration';

const CDK_FILE = 'packages/common/constructs/src/core/user-identity.ts';
const TERRAFORM_IDENTITY_FILE =
  'packages/common/terraform/src/core/user-identity/identity/identity.tf';
const TERRAFORM_MAIN_FILE =
  'packages/common/terraform/src/core/user-identity/main.tf';

// Verbatim pre-migration shapes, taken from the generated output before this
// change, so the "before" state is exactly what users are upgrading from
// rather than something derived from the new templates.
const PRE_MIGRATION_CDK = `import {
  IdentityPool,
  UserPoolAuthenticationProvider,
} from 'aws-cdk-lib/aws-cognito-identitypool';
import {
  CfnOutput,
  CfnResource,
  Duration,
  Lazy,
  RemovalPolicy,
  Stack,
} from 'aws-cdk-lib';
import {
  AccountRecovery,
  CfnManagedLoginBranding,
  FeaturePlan,
  ManagedLoginVersion,
  Mfa,
  OAuthScope,
  StandardThreatProtectionMode,
  UserPool,
  UserPoolClient,
  UserPoolDomain,
} from 'aws-cdk-lib/aws-cognito';
import {
  CfnLoggingConfiguration,
  CfnWebACL,
  CfnWebACLAssociation,
} from 'aws-cdk-lib/aws-wafv2';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { RuntimeConfig } from './runtime-config.js';
import { Distribution } from 'aws-cdk-lib/aws-cloudfront';
import { findCloudFrontDomainNames } from './cloudfront.js';
import { suppressRules } from './checkov.js';

const WEB_CLIENT_ID = 'WebClient';

/** Local dev server origins permitted to complete the sign-in redirect */
const LOCAL_CALLBACK_URLS = ['http://localhost:4200', 'http://localhost:4300'];

export interface UserIdentityProps {
  /**
   * Whether to enable AWS WAFv2 with the default managed ruleset
   * (AWSManagedRulesCommonRuleSet and AWSManagedRulesKnownBadInputsRuleSet)
   * and associate it with the user pool.
   *
   * @default true
   */
  readonly enableWaf?: boolean;
}

/**
 * Creates a UserPool and Identity Pool with sane defaults configured intended for usage from a web client.
 */
export class UserIdentity extends Construct {
  public readonly region: string;
  public readonly identityPool: IdentityPool;
  public readonly userPool: UserPool;
  public readonly userPoolClient: UserPoolClient;
  public readonly userPoolDomain: UserPoolDomain;

  /** The WAFv2 Web ACL associated with the user pool, if WAF is enabled */
  public readonly webAcl?: CfnWebACL;

  constructor(
    scope: Construct,
    id: string,
    { enableWaf = true }: UserIdentityProps = {},
  ) {
    super(scope, id);

    this.region = Stack.of(this).region;
    this.userPool = this.createUserPool();

    if (enableWaf) {
      this.webAcl = this.createWebAcl(
        id,
        this.userPool,
        LOCAL_CALLBACK_URLS.length > 0
      );
    }
    this.userPoolDomain = this.createUserPoolDomain(this.userPool);
    this.userPoolClient = this.createUserPoolClient(this.userPool);
  }

  private createUserPool = () => {
    const userPool = new UserPool(this, 'UserPool', {
      deletionProtection: true,
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(3),
      },
      mfa: Mfa.REQUIRED,
      featurePlan: FeaturePlan.PLUS,
      standardThreatProtectionMode: StandardThreatProtectionMode.AUDIT_ONLY,
      mfaSecondFactor: { sms: true, otp: true },
      signInCaseSensitive: false,
      signInAliases: { username: true, email: true },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      selfSignUpEnabled: true,
      standardAttributes: {
        phoneNumber: { required: false },
        email: { required: true },
        givenName: { required: true },
        familyName: { required: true },
      },
      autoVerify: {
        email: true,
        phone: true,
      },
      keepOriginal: {
        email: true,
        phone: true,
      },
    });
    return userPool;
  };
}
`;

const PRE_MIGRATION_TERRAFORM_IDENTITY = `variable "user_pool_domain_prefix" {
  description = "Prefix for the Cognito User Pool domain"
  type        = string
}

variable "allow_signup" {
  description = "Set to true to allow users to sign themselves up"
  type        = bool
}

variable "enable_waf" {
  description = "Whether to enable AWS WAFv2 with the default managed ruleset (AWSManagedRulesCommonRuleSet and AWSManagedRulesKnownBadInputsRuleSet) and associate it with the user pool"
  type        = bool
  default     = true
}

resource "random_id" "unique_suffix" {
  byte_length = 4
}

resource "random_uuid" "sms_external_id" {}

resource "aws_iam_role" "cognito_sms_role" {
  name = "cognito-sms-role-\${random_id.unique_suffix.hex}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "cognito-idp.amazonaws.com"
        }
        Condition = {
          StringEquals = {
            "sts:ExternalId" = random_uuid.sms_external_id.result
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "cognito_sms_policy" {
  # checkov:skip=CKV_AWS_290:Cognito SMS requires sns:Publish with wildcard resource
  # checkov:skip=CKV_AWS_355:Cognito SMS requires sns:Publish with wildcard resource
  name = "cognito-sms-policy-\${random_id.unique_suffix.hex}"
  role = aws_iam_role.cognito_sms_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sns:Publish"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_cognito_user_pool" "user_pool" {
  name                = "UserPool-\${random_id.unique_suffix.hex}"
  deletion_protection = "ACTIVE"

  admin_create_user_config {
    allow_admin_create_user_only = !var.allow_signup
  }

  mfa_configuration = "ON"

  software_token_mfa_configuration {
    enabled = true
  }

  sms_configuration {
    external_id    = random_uuid.sms_external_id.result
    sns_caller_arn = aws_iam_role.cognito_sms_role.arn
    sns_region     = data.aws_region.current.region
  }

  depends_on = [aws_iam_role_policy.cognito_sms_policy]

  auto_verified_attributes = ["email", "phone_number"]

  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email", "phone_number"]
  }
}
`;

const PRE_MIGRATION_TERRAFORM_MAIN = `variable "enable_waf" {
  description = "Whether to enable AWS WAFv2 with the default managed ruleset and associate it with the user pool"
  type        = bool
  default     = true
}

module "identity" {
  source = "./identity"

  user_pool_domain_prefix = "test"
  allow_signup = true
  enable_waf = var.enable_waf
}

output "region" {
  description = "AWS region"
  value       = module.identity.region
}
`;

describe('user-identity-configurable-mfa migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should be a no-op when the workspace has no UserIdentity', async () => {
    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
  });

  it('should surface mfa and mfaSecondFactor on the CDK construct', async () => {
    tree.write(CDK_FILE, PRE_MIGRATION_CDK);

    const result = await migration(tree);

    const migrated = tree.read(CDK_FILE, 'utf-8') ?? '';
    expect(migrated).toContain('type MfaSecondFactor');
    expect(migrated).toContain('readonly mfa?: Mfa;');
    expect(migrated).toContain('readonly mfaSecondFactor?: MfaSecondFactor;');
    expect(migrated).toContain('mfa = Mfa.REQUIRED,');
    expect(migrated).toContain('mfaSecondFactor = { sms: true, otp: true },');
    expect(migrated).toContain(
      'this.userPool = this.createUserPool(mfa, mfaSecondFactor);',
    );
    expect(migrated).toContain(
      'private createUserPool = (mfa: Mfa, mfaSecondFactor: MfaSecondFactor) => {',
    );
    expect(migrated).toContain('mfa,\n      featurePlan: FeaturePlan.PLUS,');
    expect(migrated).toContain(
      'standardThreatProtectionMode: StandardThreatProtectionMode.AUDIT_ONLY,\n      mfaSecondFactor,',
    );
    expect(migrated).not.toContain('mfa: Mfa.REQUIRED,');
    expect(migrated).not.toContain(
      'mfaSecondFactor: { sms: true, otp: true },',
    );
    expect(result.nextSteps).toEqual([]);
  });

  it('should surface mfa and mfaSecondFactor variables on the terraform identity module', async () => {
    tree.write(TERRAFORM_IDENTITY_FILE, PRE_MIGRATION_TERRAFORM_IDENTITY);

    const result = await migration(tree);

    const migrated = tree.read(TERRAFORM_IDENTITY_FILE, 'utf-8') ?? '';
    expect(migrated).toContain('variable "mfa" {');
    expect(migrated).toContain('variable "mfa_second_factor_otp" {');
    expect(migrated).toContain('variable "mfa_second_factor_sms" {');
    expect(migrated).toContain('mfa_configuration = var.mfa');
    expect(migrated).toContain('enabled = var.mfa_second_factor_otp');
    expect(migrated).toContain('dynamic "sms_configuration"');
    expect(migrated).toContain(
      'for_each = var.mfa_second_factor_sms ? [1] : []',
    );
    expect(migrated).toContain('random_uuid.sms_external_id[0].result');
    expect(migrated).toContain('aws_iam_role.cognito_sms_role[0].arn');
    expect(migrated).toContain('aws_iam_role.cognito_sms_role[0].id');
    // depends_on stays a plain resource reference (not a [*] splat, which
    // terraform rejects there) - unaffected by count, so untouched by the migration.
    expect(migrated).toContain(
      'depends_on = [aws_iam_role_policy.cognito_sms_policy]',
    );
    expect(migrated).toContain('count = var.mfa_second_factor_sms ? 1 : 0');
    expect(migrated).toContain(
      'auto_verified_attributes = var.mfa_second_factor_sms ? ["email", "phone_number"] : ["email"]',
    );
    expect(migrated).toContain(
      'attributes_require_verification_before_update = var.mfa_second_factor_sms ? ["email", "phone_number"] : ["email"]',
    );
    expect(migrated).not.toContain('mfa_configuration = "ON"');
    expect(result.nextSteps).toEqual([]);
  });

  it('should surface mfa and mfaSecondFactor variables on the terraform main module', async () => {
    tree.write(TERRAFORM_MAIN_FILE, PRE_MIGRATION_TERRAFORM_MAIN);

    const result = await migration(tree);

    const migrated = tree.read(TERRAFORM_MAIN_FILE, 'utf-8') ?? '';
    expect(migrated).toContain('variable "mfa" {');
    expect(migrated).toContain('variable "mfa_second_factor_otp" {');
    expect(migrated).toContain('variable "mfa_second_factor_sms" {');
    expect(migrated).toContain('mfa = var.mfa');
    expect(migrated).toContain(
      'mfa_second_factor_otp = var.mfa_second_factor_otp',
    );
    expect(migrated).toContain(
      'mfa_second_factor_sms = var.mfa_second_factor_sms',
    );
    expect(result.nextSteps).toEqual([]);
  });

  it('should be idempotent', async () => {
    tree.write(CDK_FILE, PRE_MIGRATION_CDK);
    tree.write(TERRAFORM_IDENTITY_FILE, PRE_MIGRATION_TERRAFORM_IDENTITY);
    tree.write(TERRAFORM_MAIN_FILE, PRE_MIGRATION_TERRAFORM_MAIN);

    await migration(tree);
    const cdkAfterFirstRun = tree.read(CDK_FILE, 'utf-8');
    const identityAfterFirstRun = tree.read(TERRAFORM_IDENTITY_FILE, 'utf-8');
    const mainAfterFirstRun = tree.read(TERRAFORM_MAIN_FILE, 'utf-8');

    const result = await migration(tree);

    expect(tree.read(CDK_FILE, 'utf-8')).toEqual(cdkAfterFirstRun);
    expect(tree.read(TERRAFORM_IDENTITY_FILE, 'utf-8')).toEqual(
      identityAfterFirstRun,
    );
    expect(tree.read(TERRAFORM_MAIN_FILE, 'utf-8')).toEqual(mainAfterFirstRun);
    expect(result.nextSteps).toEqual([]);
  });

  it('should skip and report a customised CDK construct', async () => {
    const customised = PRE_MIGRATION_CDK.replace(
      'private createUserPool = () => {',
      'private createUserPool = (customArg: string) => {',
    );
    tree.write(CDK_FILE, customised);

    const result = await migration(tree);

    const migrated = tree.read(CDK_FILE, 'utf-8') ?? '';
    expect(migrated).not.toContain('mfa = Mfa.REQUIRED,');
    expect(migrated).not.toContain('readonly mfa?: Mfa;');
    expect(migrated).toContain('createUserPool = (customArg: string) => {');
    expect(result.nextSteps.some((step) => step.includes(CDK_FILE))).toBe(true);
  });
});
