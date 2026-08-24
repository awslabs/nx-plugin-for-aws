/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { tsReactWebsiteGenerator } from '../../../ts/react-website/app/generator.js';
import { tsWebsiteAuthGenerator } from '../../../ts/website/auth/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const CDK_FILE = 'packages/common/constructs/src/core/user-identity.ts';
const TERRAFORM_FILE =
  'packages/common/terraform/src/core/user-identity/identity/identity.tf';

const SSRF_RULE = 'EC2MetaDataSSRF_QUERYARGUMENTS';

// The constructs as generated before the fix — verbatim, so the "before" state is
// exactly what users are upgrading from rather than something derived.
const PRE_FIX_CDK = `import {
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
      this.webAcl = this.createWebAcl(id, this.userPool);
    }
    this.userPoolDomain = this.createUserPoolDomain(this.userPool);
    this.userPoolClient = this.createUserPoolClient(this.userPool);
    this.identityPool = this.createIdentityPool(
      this.userPool,
      this.userPoolClient,
    );
    this.createManagedLoginBranding(
      this.userPool,
      this.userPoolClient,
      this.userPoolDomain,
    );

    RuntimeConfig.ensure(this).set('connection', 'cognitoProps', {
      region: Stack.of(this).region,
      identityPoolId: this.identityPool.identityPoolId,
      userPoolId: this.userPool.userPoolId,
      userPoolWebClientId: this.userPoolClient.userPoolClientId,
    });

    suppressRules(
      this.userPool,
      ['CKV_AWS_111'],
      'SMS Role requires wildcard resource',
      (c) => c.node.path.includes('/smsRole/'),
    );

    new CfnOutput(this, \`\${id}-UserPoolId\`, {
      value: this.userPool.userPoolId,
    });

    new CfnOutput(this, \`\${id}-UserPoolClientId\`, {
      value: this.userPoolClient.userPoolClientId,
    });

    new CfnOutput(this, \`\${id}-IdentityPoolId\`, {
      value: this.identityPool.identityPoolId,
    });
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
      // Audit-only logs threat assessments without blocking sign-in. Switch to FULL_FUNCTION to enforce automatic responses.
      standardThreatProtectionMode: StandardThreatProtectionMode.AUDIT_ONLY,
      mfaSecondFactor: { sms: true, otp: true },
      signInCaseSensitive: false,
      signInAliases: { username: true, email: true },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      selfSignUpEnabled: false,
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
    // Retain the SMS role alongside the pool so the pool can still be updated and deleted manually
    const poolCfn = userPool.node.defaultChild as CfnResource;
    const smsRoleNode = userPool.node.tryFindChild('smsRole');
    if (smsRoleNode) {
      const smsRoleCfn = smsRoleNode.node.defaultChild as CfnResource;
      smsRoleCfn.cfnOptions.deletionPolicy = poolCfn.cfnOptions.deletionPolicy;
      smsRoleCfn.cfnOptions.updateReplacePolicy =
        poolCfn.cfnOptions.updateReplacePolicy;
    }
    return userPool;
  };

  private createWebAcl = (id: string, userPool: UserPool) => {
    const webAcl = new CfnWebACL(this, 'WebAcl', {
      defaultAction: { allow: {} },
      scope: 'REGIONAL',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: \`\${id}WebAcl\`,
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: 'CRSRule',
          priority: 0,
          statement: {
            managedRuleGroupStatement: {
              name: 'AWSManagedRulesCommonRuleSet',
              vendorName: 'AWS',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: \`\${id}WebAcl-CRS\`,
            sampledRequestsEnabled: true,
          },
          overrideAction: {
            none: {},
          },
        },
        {
          name: 'KnownBadInputsRule',
          priority: 1,
          statement: {
            managedRuleGroupStatement: {
              name: 'AWSManagedRulesKnownBadInputsRuleSet',
              vendorName: 'AWS',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: \`\${id}WebAcl-KnownBadInputs\`,
            sampledRequestsEnabled: true,
          },
          overrideAction: {
            none: {},
          },
        },
      ],
    });

    new CfnWebACLAssociation(this, 'WebAclAssociation', {
      resourceArn: userPool.userPoolArn,
      webAclArn: webAcl.attrArn,
    });

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

  private createUserPoolDomain = (userPool: UserPool) =>
    new UserPoolDomain(this, 'UserPoolDomain', {
      userPool,
      cognitoDomain: {
        domainPrefix: \`proj-test-website-\${Stack.of(this).account}\`,
      },
      managedLoginVersion: ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

  private createUserPoolClient = (userPool: UserPool) => {
    const lazilyComputedCallbackUrls = Lazy.list({
      produce: () =>
        ['http://localhost:4200', 'http://localhost:4300'].concat(
          Stack.of(this)
            .node.findAll()
            .filter(
              (child): child is Distribution => child instanceof Distribution,
            )
            .flatMap(findCloudFrontDomainNames)
            .map((domain) => \`https://\${domain}\`),
        ),
    });

    return userPool.addClient(WEB_CLIENT_ID, {
      authFlows: {
        userPassword: true,
        userSrp: true,
        user: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [OAuthScope.EMAIL, OAuthScope.OPENID, OAuthScope.PROFILE],
        callbackUrls: lazilyComputedCallbackUrls,
        logoutUrls: lazilyComputedCallbackUrls,
      },
      preventUserExistenceErrors: true,
    });
  };

  private createIdentityPool = (
    userPool: UserPool,
    userPoolClient: UserPoolClient,
  ) => {
    const identityPool = new IdentityPool(this, 'IdentityPool');

    identityPool.addUserPoolAuthentication(
      new UserPoolAuthenticationProvider({
        userPool,
        userPoolClient,
      }),
    );

    return identityPool;
  };

  private createManagedLoginBranding = (
    userPool: UserPool,
    userPoolClient: UserPoolClient,
    userPoolDomain: UserPoolDomain,
  ) => {
    new CfnManagedLoginBranding(this, 'ManagedLoginBranding', {
      userPoolId: userPool.userPoolId,
      clientId: userPoolClient.userPoolClientId,
      useCognitoProvidedValues: true,
    }).node.addDependency(userPoolClient, userPool, userPoolDomain);
  };
}
`;

const PRE_FIX_TERRAFORM = `terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.55.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "3.9.0"
    }
  }
}

# Variables
variable "user_pool_domain_prefix" {
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

variable "callback_urls" {
  description = "Additional callback URLs for the user pool client"
  type        = list(string)
  default     = []
}

variable "logout_urls" {
  description = "Additional logout URLs for the user pool client"
  type        = list(string)
  default     = []
}

# Data sources
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# Random suffix for resource names
resource "random_id" "unique_suffix" {
  byte_length = 4
}

# Generate a random external ID for SMS role security
resource "random_uuid" "sms_external_id" {}

# IAM role for SMS MFA
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
          ArnLike = {
            "aws:SourceArn" = "arn:aws:cognito-idp:\${data.aws_region.current.region}:\${data.aws_caller_identity.current.account_id}:userpool/*"
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

# Cognito User Pool
resource "aws_cognito_user_pool" "user_pool" {
  name                = "UserPool-\${random_id.unique_suffix.hex}"
  deletion_protection = "ACTIVE"

  admin_create_user_config {
    allow_admin_create_user_only = !var.allow_signup
  }

  # Password policy
  password_policy {
    minimum_length                   = 8
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 3
  }

  # MFA configuration
  mfa_configuration = "ON"

  # Software token MFA configuration
  software_token_mfa_configuration {
    enabled = true
  }

  # SMS MFA configuration
  sms_configuration {
    external_id    = random_uuid.sms_external_id.result
    sns_caller_arn = aws_iam_role.cognito_sms_role.arn
    sns_region     = data.aws_region.current.region
  }

  depends_on = [aws_iam_role_policy.cognito_sms_policy]

  # Sign-in configuration
  username_configuration {
    case_sensitive = false
  }

  alias_attributes = ["email"]

  # Account recovery
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # Auto verification
  auto_verified_attributes = ["email", "phone_number"]

  # User pool tier (equivalent to FeaturePlan.PLUS)
  user_pool_tier = "PLUS"

  # Threat protection. AUDIT logs threat assessments without blocking sign-in; switch to ENFORCED to apply automatic responses.
  user_pool_add_ons {
    advanced_security_mode = "AUDIT"
  }

  # Schema attributes
  schema {
    attribute_data_type = "String"
    name                = "email"
    required            = true
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  schema {
    attribute_data_type = "String"
    name                = "given_name"
    required            = true
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  schema {
    attribute_data_type = "String"
    name                = "family_name"
    required            = true
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  schema {
    attribute_data_type = "String"
    name                = "phone_number"
    required            = false
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  # User attribute update settings - require verification before update
  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email", "phone_number"]
  }

  # Verification message templates
  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_message         = "The verification code to your new account is {####}"
    email_subject         = "Verify your new account"
    sms_message          = "The verification code to your new account is {####}"
  }

  tags = {
    Name = "UserPool-\${random_id.unique_suffix.hex}"
  }
}

# User Pool Domain - temporarily commented out to resolve domain conflicts
# Will be re-enabled after User Pool Client OAuth configuration is fixed
resource "aws_cognito_user_pool_domain" "user_pool_domain" {
  domain                   = "\${var.user_pool_domain_prefix}-\${data.aws_caller_identity.current.account_id}-\${random_id.unique_suffix.hex}"
  user_pool_id            = aws_cognito_user_pool.user_pool.id
  managed_login_version   = 2
}

# WAFv2 Web ACL for the user pool
resource "aws_wafv2_web_acl" "user_pool_waf" {
  #checkov:skip=CKV2_AWS_31:Logging configuration is defined below in aws_wafv2_web_acl_logging_configuration.user_pool_waf_logging; Checkov does not resolve the separate resource
  count = var.enable_waf ? 1 : 0

  name  = "UserPool-\${random_id.unique_suffix.hex}-waf"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "CRSRule"
    priority = 0

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "UserPoolWebAcl-CRS"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "KnownBadInputsRule"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "UserPoolWebAcl-KnownBadInputs"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "UserPoolWebAcl"
    sampled_requests_enabled   = true
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_wafv2_web_acl_association" "user_pool_waf_association" {
  count = var.enable_waf ? 1 : 0

  resource_arn = aws_cognito_user_pool.user_pool.arn
  web_acl_arn  = aws_wafv2_web_acl.user_pool_waf[0].arn
}

# CloudWatch Log Group for WAF request logs. Name must start with \`aws-waf-logs-\`.
resource "aws_cloudwatch_log_group" "user_pool_waf_logs" {
  #checkov:skip=CKV_AWS_158:Using default CloudWatch log encryption
  #checkov:skip=CKV_AWS_338:Log retention set to one month which is sufficient for WAF logs
  count = var.enable_waf ? 1 : 0

  name              = "aws-waf-logs-UserPool-\${random_id.unique_suffix.hex}"
  retention_in_days = 30
}

resource "aws_wafv2_web_acl_logging_configuration" "user_pool_waf_logging" {
  count = var.enable_waf ? 1 : 0

  log_destination_configs = [aws_cloudwatch_log_group.user_pool_waf_logs[0].arn]
  resource_arn            = aws_wafv2_web_acl.user_pool_waf[0].arn
}

# User Pool Client
resource "aws_cognito_user_pool_client" "web_client" {
  name         = "WebClient-\${random_id.unique_suffix.hex}"
  user_pool_id = aws_cognito_user_pool.user_pool.id

  # Auth flows - match CDK implementation (order matches CloudFormation)
  explicit_auth_flows = [
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_AUTH",
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_USER_SRP_AUTH"
  ]

  # Supported identity providers
  supported_identity_providers = ["COGNITO"]

  # OAuth configuration - MUST be set before callback/logout URLs
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows = ["code"]
  allowed_oauth_scopes = ["email", "openid", "profile"]

  # OAuth-dependent URLs - set after OAuth configuration
  callback_urls = concat([
    "http://localhost:4200",
    "http://localhost:4300"
  ], var.callback_urls)

  logout_urls = concat([
    "http://localhost:4200",
    "http://localhost:4300"
  ], var.logout_urls)

  # Security settings
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation = true
  enable_propagate_additional_user_context_data = false

  # Token validity - ONLY refresh token to match CloudFormation exactly
  refresh_token_validity = 30

  # Auth session validity
  auth_session_validity = 3

  # Callback urls are added via the add-callback-url module and should not be overwritten.
  lifecycle {
    ignore_changes = [
      callback_urls,
      logout_urls
    ]
  }

}

# Identity Pool
resource "aws_cognito_identity_pool" "identity_pool" {
  identity_pool_name               = "IdentityPool-\${random_id.unique_suffix.hex}"
  allow_unauthenticated_identities = false

  cognito_identity_providers {
    client_id               = aws_cognito_user_pool_client.web_client.id
    provider_name           = aws_cognito_user_pool.user_pool.endpoint
    server_side_token_check = true
  }

  tags = {
    Name = "IdentityPool-\${random_id.unique_suffix.hex}"
  }
}

# IAM roles for identity pool
resource "aws_iam_role" "authenticated_role" {
  name = "cognito-authenticated-role-\${random_id.unique_suffix.hex}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = "cognito-identity.amazonaws.com"
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "cognito-identity.amazonaws.com:aud" = aws_cognito_identity_pool.identity_pool.id
          }
          "ForAnyValue:StringLike" = {
            "cognito-identity.amazonaws.com:amr" = "authenticated"
          }
        }
      }
    ]
  })
}

resource "aws_iam_role" "unauthenticated_role" {
  name = "cognito-unauthenticated-role-\${random_id.unique_suffix.hex}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = "cognito-identity.amazonaws.com"
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "cognito-identity.amazonaws.com:aud" = aws_cognito_identity_pool.identity_pool.id
          }
          "ForAnyValue:StringLike" = {
            "cognito-identity.amazonaws.com:amr" = "unauthenticated"
          }
        }
      }
    ]
  })
}

# Attach roles to identity pool
resource "aws_cognito_identity_pool_roles_attachment" "identity_pool_roles" {
  identity_pool_id = aws_cognito_identity_pool.identity_pool.id

  roles = {
    "authenticated"   = aws_iam_role.authenticated_role.arn
    "unauthenticated" = aws_iam_role.unauthenticated_role.arn
  }
}

# Managed Login Branding - temporarily commented out to resolve state conflicts
# Will be re-enabled after User Pool Client OAuth configuration is fixed
resource "aws_cognito_managed_login_branding" "managed_login_branding" {
  user_pool_id                = aws_cognito_user_pool.user_pool.id
  client_id                   = aws_cognito_user_pool_client.web_client.id
  use_cognito_provided_values = true

  depends_on = [
    aws_cognito_user_pool.user_pool,
    aws_cognito_user_pool_client.web_client,
    aws_cognito_user_pool_domain.user_pool_domain  # commented out with domain
  ]

}

# Always add cognito props to runtime config
module "add_cognito_to_runtime_config" {
  source = "../../runtime-config/entry"

  namespace = "connection"
  key       = "cognitoProps"
  value = {
    region              = data.aws_region.current.region
    identityPoolId      = aws_cognito_identity_pool.identity_pool.id
    userPoolId          = aws_cognito_user_pool.user_pool.id
    userPoolWebClientId = aws_cognito_user_pool_client.web_client.id
  }
}

# Outputs
output "region" {
  description = "AWS region"
  value       = data.aws_region.current.region
}

output "user_pool_id" {
  description = "ID of the Cognito User Pool"
  value       = aws_cognito_user_pool.user_pool.id
}

output "user_pool_arn" {
  description = "ARN of the Cognito User Pool"
  value       = aws_cognito_user_pool.user_pool.arn
}

output "user_pool_client_id" {
  description = "ID of the Cognito User Pool Client"
  value       = aws_cognito_user_pool_client.web_client.id
}

output "identity_pool_id" {
  description = "ID of the Cognito Identity Pool"
  value       = aws_cognito_identity_pool.identity_pool.id
}

output "authenticated_role_name" {
  description = "Name of the authenticated IAM role"
  value       = aws_iam_role.authenticated_role.name
}

output "authenticated_role_arn" {
  description = "ARN of the authenticated IAM role"
  value       = aws_iam_role.authenticated_role.arn
}

output "user_pool_domain" {
  description = "Domain of the Cognito User Pool"
  value       = aws_cognito_user_pool_domain.user_pool_domain.domain
}
`;

// The constructs this migration is responsible for producing, pinned rather than
// read from the templates: the migration's job is to bring a workspace up to the
// version released with this change, so it must keep producing this exact output
// even after the templates move on.
const EXPECTED_CDK = `import {
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
        LOCAL_CALLBACK_URLS.length > 0,
      );
    }
    this.userPoolDomain = this.createUserPoolDomain(this.userPool);
    this.userPoolClient = this.createUserPoolClient(this.userPool);
    this.identityPool = this.createIdentityPool(
      this.userPool,
      this.userPoolClient,
    );
    this.createManagedLoginBranding(
      this.userPool,
      this.userPoolClient,
      this.userPoolDomain,
    );

    RuntimeConfig.ensure(this).set('connection', 'cognitoProps', {
      region: Stack.of(this).region,
      identityPoolId: this.identityPool.identityPoolId,
      userPoolId: this.userPool.userPoolId,
      userPoolWebClientId: this.userPoolClient.userPoolClientId,
    });

    suppressRules(
      this.userPool,
      ['CKV_AWS_111'],
      'SMS Role requires wildcard resource',
      (c) => c.node.path.includes('/smsRole/'),
    );

    new CfnOutput(this, \`\${id}-UserPoolId\`, {
      value: this.userPool.userPoolId,
    });

    new CfnOutput(this, \`\${id}-UserPoolClientId\`, {
      value: this.userPoolClient.userPoolClientId,
    });

    new CfnOutput(this, \`\${id}-IdentityPoolId\`, {
      value: this.identityPool.identityPoolId,
    });
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
      // Audit-only logs threat assessments without blocking sign-in. Switch to FULL_FUNCTION to enforce automatic responses.
      standardThreatProtectionMode: StandardThreatProtectionMode.AUDIT_ONLY,
      mfaSecondFactor: { sms: true, otp: true },
      signInCaseSensitive: false,
      signInAliases: { username: true, email: true },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      selfSignUpEnabled: false,
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
    // Retain the SMS role alongside the pool so the pool can still be updated and deleted manually
    const poolCfn = userPool.node.defaultChild as CfnResource;
    const smsRoleNode = userPool.node.tryFindChild('smsRole');
    if (smsRoleNode) {
      const smsRoleCfn = smsRoleNode.node.defaultChild as CfnResource;
      smsRoleCfn.cfnOptions.deletionPolicy = poolCfn.cfnOptions.deletionPolicy;
      smsRoleCfn.cfnOptions.updateReplacePolicy =
        poolCfn.cfnOptions.updateReplacePolicy;
    }
    return userPool;
  };

  private createWebAcl = (
    id: string,
    userPool: UserPool,
    allowsLocalCallback: boolean,
  ) => {
    const webAcl = new CfnWebACL(this, 'WebAcl', {
      defaultAction: { allow: {} },
      scope: 'REGIONAL',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: \`\${id}WebAcl\`,
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: 'CRSRule',
          priority: 0,
          statement: {
            managedRuleGroupStatement: {
              name: 'AWSManagedRulesCommonRuleSet',
              vendorName: 'AWS',
              // EC2MetaDataSSRF_QUERYARGUMENTS treats the loopback redirect_uri the
              // Hosted UI receives during local sign-in as an SSRF attempt. Counted
              // only while a local callback URL is allowed; every other rule blocks.
              ruleActionOverrides: allowsLocalCallback
                ? [
                    {
                      name: 'EC2MetaDataSSRF_QUERYARGUMENTS',
                      actionToUse: { count: {} },
                    },
                  ]
                : undefined,
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: \`\${id}WebAcl-CRS\`,
            sampledRequestsEnabled: true,
          },
          overrideAction: {
            none: {},
          },
        },
        {
          name: 'KnownBadInputsRule',
          priority: 1,
          statement: {
            managedRuleGroupStatement: {
              name: 'AWSManagedRulesKnownBadInputsRuleSet',
              vendorName: 'AWS',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: \`\${id}WebAcl-KnownBadInputs\`,
            sampledRequestsEnabled: true,
          },
          overrideAction: {
            none: {},
          },
        },
      ],
    });

    new CfnWebACLAssociation(this, 'WebAclAssociation', {
      resourceArn: userPool.userPoolArn,
      webAclArn: webAcl.attrArn,
    });

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

  private createUserPoolDomain = (userPool: UserPool) =>
    new UserPoolDomain(this, 'UserPoolDomain', {
      userPool,
      cognitoDomain: {
        domainPrefix: \`proj-test-website-\${Stack.of(this).account}\`,
      },
      managedLoginVersion: ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

  private createUserPoolClient = (userPool: UserPool) => {
    const lazilyComputedCallbackUrls = Lazy.list({
      produce: () =>
        LOCAL_CALLBACK_URLS.concat(
          Stack.of(this)
            .node.findAll()
            .filter(
              (child): child is Distribution => child instanceof Distribution,
            )
            .flatMap(findCloudFrontDomainNames)
            .map((domain) => \`https://\${domain}\`),
        ),
    });

    return userPool.addClient(WEB_CLIENT_ID, {
      authFlows: {
        userPassword: true,
        userSrp: true,
        user: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [OAuthScope.EMAIL, OAuthScope.OPENID, OAuthScope.PROFILE],
        callbackUrls: lazilyComputedCallbackUrls,
        logoutUrls: lazilyComputedCallbackUrls,
      },
      preventUserExistenceErrors: true,
    });
  };

  private createIdentityPool = (
    userPool: UserPool,
    userPoolClient: UserPoolClient,
  ) => {
    const identityPool = new IdentityPool(this, 'IdentityPool');

    identityPool.addUserPoolAuthentication(
      new UserPoolAuthenticationProvider({
        userPool,
        userPoolClient,
      }),
    );

    return identityPool;
  };

  private createManagedLoginBranding = (
    userPool: UserPool,
    userPoolClient: UserPoolClient,
    userPoolDomain: UserPoolDomain,
  ) => {
    new CfnManagedLoginBranding(this, 'ManagedLoginBranding', {
      userPoolId: userPool.userPoolId,
      clientId: userPoolClient.userPoolClientId,
      useCognitoProvidedValues: true,
    }).node.addDependency(userPoolClient, userPool, userPoolDomain);
  };
}
`;

const EXPECTED_TERRAFORM = `terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.55.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "3.9.0"
    }
  }
}

# Variables
variable "user_pool_domain_prefix" {
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

variable "callback_urls" {
  description = "Additional callback URLs for the user pool client"
  type        = list(string)
  default     = []
}

variable "logout_urls" {
  description = "Additional logout URLs for the user pool client"
  type        = list(string)
  default     = []
}

# Data sources
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  # Local dev server origins permitted to complete the sign-in redirect
  local_callback_urls = [
    "http://localhost:4200",
    "http://localhost:4300"
  ]
}

# Random suffix for resource names
resource "random_id" "unique_suffix" {
  byte_length = 4
}

# Generate a random external ID for SMS role security
resource "random_uuid" "sms_external_id" {}

# IAM role for SMS MFA
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
          ArnLike = {
            "aws:SourceArn" = "arn:aws:cognito-idp:\${data.aws_region.current.region}:\${data.aws_caller_identity.current.account_id}:userpool/*"
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

# Cognito User Pool
resource "aws_cognito_user_pool" "user_pool" {
  name                = "UserPool-\${random_id.unique_suffix.hex}"
  deletion_protection = "ACTIVE"

  admin_create_user_config {
    allow_admin_create_user_only = !var.allow_signup
  }

  # Password policy
  password_policy {
    minimum_length                   = 8
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 3
  }

  # MFA configuration
  mfa_configuration = "ON"

  # Software token MFA configuration
  software_token_mfa_configuration {
    enabled = true
  }

  # SMS MFA configuration
  sms_configuration {
    external_id    = random_uuid.sms_external_id.result
    sns_caller_arn = aws_iam_role.cognito_sms_role.arn
    sns_region     = data.aws_region.current.region
  }

  depends_on = [aws_iam_role_policy.cognito_sms_policy]

  # Sign-in configuration
  username_configuration {
    case_sensitive = false
  }

  alias_attributes = ["email"]

  # Account recovery
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # Auto verification
  auto_verified_attributes = ["email", "phone_number"]

  # User pool tier (equivalent to FeaturePlan.PLUS)
  user_pool_tier = "PLUS"

  # Threat protection. AUDIT logs threat assessments without blocking sign-in; switch to ENFORCED to apply automatic responses.
  user_pool_add_ons {
    advanced_security_mode = "AUDIT"
  }

  # Schema attributes
  schema {
    attribute_data_type = "String"
    name                = "email"
    required            = true
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  schema {
    attribute_data_type = "String"
    name                = "given_name"
    required            = true
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  schema {
    attribute_data_type = "String"
    name                = "family_name"
    required            = true
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  schema {
    attribute_data_type = "String"
    name                = "phone_number"
    required            = false
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  # User attribute update settings - require verification before update
  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email", "phone_number"]
  }

  # Verification message templates
  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_message         = "The verification code to your new account is {####}"
    email_subject         = "Verify your new account"
    sms_message          = "The verification code to your new account is {####}"
  }

  tags = {
    Name = "UserPool-\${random_id.unique_suffix.hex}"
  }
}

# User Pool Domain - temporarily commented out to resolve domain conflicts
# Will be re-enabled after User Pool Client OAuth configuration is fixed
resource "aws_cognito_user_pool_domain" "user_pool_domain" {
  domain                   = "\${var.user_pool_domain_prefix}-\${data.aws_caller_identity.current.account_id}-\${random_id.unique_suffix.hex}"
  user_pool_id            = aws_cognito_user_pool.user_pool.id
  managed_login_version   = 2
}

# WAFv2 Web ACL for the user pool
resource "aws_wafv2_web_acl" "user_pool_waf" {
  #checkov:skip=CKV2_AWS_31:Logging configuration is defined below in aws_wafv2_web_acl_logging_configuration.user_pool_waf_logging; Checkov does not resolve the separate resource
  count = var.enable_waf ? 1 : 0

  name  = "UserPool-\${random_id.unique_suffix.hex}-waf"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "CRSRule"
    priority = 0

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"

        # EC2MetaDataSSRF_QUERYARGUMENTS treats the loopback redirect_uri the
        # Hosted UI receives during local sign-in as an SSRF attempt. Counted
        # only while a local callback URL is allowed; every other rule blocks.
        dynamic "rule_action_override" {
          for_each = length(local.local_callback_urls) > 0 ? [1] : []

          content {
            name = "EC2MetaDataSSRF_QUERYARGUMENTS"

            action_to_use {
              count {}
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "UserPoolWebAcl-CRS"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "KnownBadInputsRule"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "UserPoolWebAcl-KnownBadInputs"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "UserPoolWebAcl"
    sampled_requests_enabled   = true
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_wafv2_web_acl_association" "user_pool_waf_association" {
  count = var.enable_waf ? 1 : 0

  resource_arn = aws_cognito_user_pool.user_pool.arn
  web_acl_arn  = aws_wafv2_web_acl.user_pool_waf[0].arn
}

# CloudWatch Log Group for WAF request logs. Name must start with \`aws-waf-logs-\`.
resource "aws_cloudwatch_log_group" "user_pool_waf_logs" {
  #checkov:skip=CKV_AWS_158:Using default CloudWatch log encryption
  #checkov:skip=CKV_AWS_338:Log retention set to one month which is sufficient for WAF logs
  count = var.enable_waf ? 1 : 0

  name              = "aws-waf-logs-UserPool-\${random_id.unique_suffix.hex}"
  retention_in_days = 30
}

resource "aws_wafv2_web_acl_logging_configuration" "user_pool_waf_logging" {
  count = var.enable_waf ? 1 : 0

  log_destination_configs = [aws_cloudwatch_log_group.user_pool_waf_logs[0].arn]
  resource_arn            = aws_wafv2_web_acl.user_pool_waf[0].arn
}

# User Pool Client
resource "aws_cognito_user_pool_client" "web_client" {
  name         = "WebClient-\${random_id.unique_suffix.hex}"
  user_pool_id = aws_cognito_user_pool.user_pool.id

  # Auth flows - match CDK implementation (order matches CloudFormation)
  explicit_auth_flows = [
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_AUTH",
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_USER_SRP_AUTH"
  ]

  # Supported identity providers
  supported_identity_providers = ["COGNITO"]

  # OAuth configuration - MUST be set before callback/logout URLs
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows = ["code"]
  allowed_oauth_scopes = ["email", "openid", "profile"]

  # OAuth-dependent URLs - set after OAuth configuration
  callback_urls = concat(local.local_callback_urls, var.callback_urls)

  logout_urls = concat(local.local_callback_urls, var.logout_urls)

  # Security settings
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation = true
  enable_propagate_additional_user_context_data = false

  # Token validity - ONLY refresh token to match CloudFormation exactly
  refresh_token_validity = 30

  # Auth session validity
  auth_session_validity = 3

  # Callback urls are added via the add-callback-url module and should not be overwritten.
  lifecycle {
    ignore_changes = [
      callback_urls,
      logout_urls
    ]
  }

}

# Identity Pool
resource "aws_cognito_identity_pool" "identity_pool" {
  identity_pool_name               = "IdentityPool-\${random_id.unique_suffix.hex}"
  allow_unauthenticated_identities = false

  cognito_identity_providers {
    client_id               = aws_cognito_user_pool_client.web_client.id
    provider_name           = aws_cognito_user_pool.user_pool.endpoint
    server_side_token_check = true
  }

  tags = {
    Name = "IdentityPool-\${random_id.unique_suffix.hex}"
  }
}

# IAM roles for identity pool
resource "aws_iam_role" "authenticated_role" {
  name = "cognito-authenticated-role-\${random_id.unique_suffix.hex}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = "cognito-identity.amazonaws.com"
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "cognito-identity.amazonaws.com:aud" = aws_cognito_identity_pool.identity_pool.id
          }
          "ForAnyValue:StringLike" = {
            "cognito-identity.amazonaws.com:amr" = "authenticated"
          }
        }
      }
    ]
  })
}

resource "aws_iam_role" "unauthenticated_role" {
  name = "cognito-unauthenticated-role-\${random_id.unique_suffix.hex}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = "cognito-identity.amazonaws.com"
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "cognito-identity.amazonaws.com:aud" = aws_cognito_identity_pool.identity_pool.id
          }
          "ForAnyValue:StringLike" = {
            "cognito-identity.amazonaws.com:amr" = "unauthenticated"
          }
        }
      }
    ]
  })
}

# Attach roles to identity pool
resource "aws_cognito_identity_pool_roles_attachment" "identity_pool_roles" {
  identity_pool_id = aws_cognito_identity_pool.identity_pool.id

  roles = {
    "authenticated"   = aws_iam_role.authenticated_role.arn
    "unauthenticated" = aws_iam_role.unauthenticated_role.arn
  }
}

# Managed Login Branding - temporarily commented out to resolve state conflicts
# Will be re-enabled after User Pool Client OAuth configuration is fixed
resource "aws_cognito_managed_login_branding" "managed_login_branding" {
  user_pool_id                = aws_cognito_user_pool.user_pool.id
  client_id                   = aws_cognito_user_pool_client.web_client.id
  use_cognito_provided_values = true

  depends_on = [
    aws_cognito_user_pool.user_pool,
    aws_cognito_user_pool_client.web_client,
    aws_cognito_user_pool_domain.user_pool_domain  # commented out with domain
  ]

}

# Always add cognito props to runtime config
module "add_cognito_to_runtime_config" {
  source = "../../runtime-config/entry"

  namespace = "connection"
  key       = "cognitoProps"
  value = {
    region              = data.aws_region.current.region
    identityPoolId      = aws_cognito_identity_pool.identity_pool.id
    userPoolId          = aws_cognito_user_pool.user_pool.id
    userPoolWebClientId = aws_cognito_user_pool_client.web_client.id
  }
}

# Outputs
output "region" {
  description = "AWS region"
  value       = data.aws_region.current.region
}

output "user_pool_id" {
  description = "ID of the Cognito User Pool"
  value       = aws_cognito_user_pool.user_pool.id
}

output "user_pool_arn" {
  description = "ARN of the Cognito User Pool"
  value       = aws_cognito_user_pool.user_pool.arn
}

output "user_pool_client_id" {
  description = "ID of the Cognito User Pool Client"
  value       = aws_cognito_user_pool_client.web_client.id
}

output "identity_pool_id" {
  description = "ID of the Cognito Identity Pool"
  value       = aws_cognito_identity_pool.identity_pool.id
}

output "authenticated_role_name" {
  description = "Name of the authenticated IAM role"
  value       = aws_iam_role.authenticated_role.name
}

output "authenticated_role_arn" {
  description = "ARN of the authenticated IAM role"
  value       = aws_iam_role.authenticated_role.arn
}

output "user_pool_domain" {
  description = "Domain of the Cognito User Pool"
  value       = aws_cognito_user_pool_domain.user_pool_domain.domain
}
`;

const FIXTURES = {
  cdk: { file: CDK_FILE, preFix: PRE_FIX_CDK, expected: EXPECTED_CDK },
  terraform: {
    file: TERRAFORM_FILE,
    preFix: PRE_FIX_TERRAFORM,
    expected: EXPECTED_TERRAFORM,
  },
};

/** Generate a website with auth, then write back the pre-fix construct. */
const generateWithPreFixConstruct = async (
  tree: Tree,
  iac: 'cdk' | 'terraform',
) => {
  await tsReactWebsiteGenerator(tree, {
    name: 'test-website',
    iac,
    ux: 'cloudscape',
  });
  await tsWebsiteAuthGenerator(tree, {
    project: 'test-website',
    allowSignup: false,
    iac,
  });
  const { file, preFix } = FIXTURES[iac];
  tree.write(file, preFix);
  return file;
};

describe('user-identity-waf-allow-localhost-callback migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should be a no-op when the workspace has no user identity', async () => {
    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
  });

  describe.each(['cdk', 'terraform'] as const)('%s', (iac) => {
    it('should start from a fixture that lacks the override', () => {
      // Guards the fixtures: if the pre-fix state already contained the
      // override, or the expected state didn't, every assertion below would
      // pass without the migration doing anything.
      expect(FIXTURES[iac].preFix).not.toContain(SSRF_RULE);
      expect(FIXTURES[iac].expected).toContain(SSRF_RULE);
    });

    it('should produce the expected construct', async () => {
      const file = await generateWithPreFixConstruct(tree, iac);

      const result = await migration(tree);

      expect(tree.read(file, 'utf-8')).toEqual(FIXTURES[iac].expected);
      // Nothing left for the user to do, so nothing is reported.
      expect(result.nextSteps).toEqual([]);
    });

    it('should leave an already-migrated workspace untouched and unreported', async () => {
      const { file, expected } = FIXTURES[iac];
      await tsReactWebsiteGenerator(tree, {
        name: 'test-website',
        iac,
        ux: 'cloudscape',
      });
      await tsWebsiteAuthGenerator(tree, {
        project: 'test-website',
        allowSignup: false,
        iac,
      });
      tree.write(file, expected);

      const result = await migration(tree);

      expect(tree.read(file, 'utf-8')).toEqual(expected);
      expect(result.nextSteps).toEqual([]);
    });

    it('should make the override conditional on a local callback URL', async () => {
      const file = await generateWithPreFixConstruct(tree, iac);

      await migration(tree);
      const migrated = tree.read(file, 'utf-8') ?? '';

      // The override is derived from the local callback URLs rather than
      // restating the condition, so removing them restores the rule to Block.
      if (iac === 'cdk') {
        expect(migrated).toContain('const LOCAL_CALLBACK_URLS');
        expect(migrated).toContain('ruleActionOverrides: allowsLocalCallback');
        expect(migrated).toContain('LOCAL_CALLBACK_URLS.length > 0');
      } else {
        expect(migrated).toContain('local_callback_urls = [');
        expect(migrated).toContain(
          'for_each = length(local.local_callback_urls) > 0 ? [1] : []',
        );
      }
    });

    it('should not touch the KnownBadInputs rule group', async () => {
      const file = await generateWithPreFixConstruct(tree, iac);

      await migration(tree);
      const migrated = tree.read(file, 'utf-8') ?? '';

      // Sliced from the KnownBadInputs rule group's own statement rather than
      // the first mention of its name, which appears in the doc comment above.
      const knownBadInputs = migrated.slice(
        migrated.lastIndexOf('AWSManagedRulesKnownBadInputsRuleSet'),
      );
      expect(knownBadInputs).not.toContain(SSRF_RULE);
      // Once in the explanatory comment, once as the overridden rule name.
      expect(migrated.match(new RegExp(SSRF_RULE, 'g'))).toHaveLength(2);
    });

    it('should skip and report a Web ACL which has diverged', async () => {
      const file = await generateWithPreFixConstruct(tree, iac);
      // A user who swapped the managed rule group for their own — the edit site
      // the migration looks for is gone.
      tree.write(
        file,
        FIXTURES[iac].preFix.replace(
          /AWSManagedRulesCommonRuleSet/g,
          'MyOrgCustomRuleGroup',
        ),
      );

      const result = await migration(tree);

      expect(tree.read(file, 'utf-8')).not.toContain(SSRF_RULE);
      expect(
        result.nextSteps.some(
          (s) => s.includes(file) && s.includes('diverged'),
        ),
      ).toBeTruthy();
    });
  });

  it('should migrate a customised Web ACL without disturbing the customisation', async () => {
    const file = await generateWithPreFixConstruct(tree, 'cdk');
    // An extra rule alongside the managed groups — the kind of local change
    // that defeats literal matching but not an AST rewrite.
    tree.write(
      file,
      PRE_FIX_CDK.replace(
        "        {\n          name: 'KnownBadInputsRule',",
        "        {\n          name: 'MyOrgRateLimit',\n          priority: 2,\n          statement: { rateBasedStatement: { limit: 2000, aggregateKeyType: 'IP' } },\n          visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: 'RateLimit', sampledRequestsEnabled: true },\n          action: { block: {} },\n        },\n        {\n          name: 'KnownBadInputsRule',",
      ),
    );

    const result = await migration(tree);
    const migrated = tree.read(file, 'utf-8') ?? '';

    expect(migrated).toContain(SSRF_RULE);
    expect(migrated).toContain('MyOrgRateLimit');
    expect(migrated).toContain('rateBasedStatement');
    expect(result.nextSteps).toEqual([]);
  });
});
