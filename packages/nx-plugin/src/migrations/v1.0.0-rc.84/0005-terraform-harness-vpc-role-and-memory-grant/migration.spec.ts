/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { agentcoreHarnessGenerator } from '../../../agentcore-harness/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const APP_MODULE_FILE =
  'packages/common/terraform/src/app/harnesses/my-harness/my-harness.tf';
const APP_MODULE_FILE_2 =
  'packages/common/terraform/src/app/harnesses/other-harness/other-harness.tf';

const divergedMessage = (filePath: string) =>
  `${filePath}: has diverged from the generated shape - left untouched. To pick up VPC support, a supplied execution role, the allowed_tools/memory/environment_variables/max_iterations/timeout_seconds variables and the corrected managed-memory grant, compare it against the agentcore-harness generator's Terraform template and apply the parts you want.`;

/**
 * The vended Terraform harness app module as an upgrading workspace has it: the
 * earlier no-tools-by-default migration has run, so `allowed_tools` is already
 * declared and assigned, but VPC support, a supplied execution role and the
 * remaining native fields are not there yet.
 */
const oldAppModule = `terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.61.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "3.6.3"
    }
  }
}

variable "model_id" {
  description = "Amazon Bedrock model or inference profile used by default."
  type        = string
  default     = "global.anthropic.claude-sonnet-4-6"
}

variable "allowed_tools" {
  description = "Tools the Harness may use. Defaults to none; set [\\"@builtin\\"] for every built-in tool, or name individual tools. Always sent explicitly, since the service treats an absent value as every tool."
  type        = list(string)
  default     = []
}

variable "model_resource_arns" {
  description = "Bedrock model and inference-profile ARNs the execution role may invoke. Defaults to every foundation model plus this account's Bedrock resources in the deployment region; replace with narrower ARNs to restrict baseline model access."
  type        = set(string)
  default     = null
}

variable "additional_execution_role_policy_statements" {
  description = "Additional least-privilege IAM policy statements required by configured optional capabilities (e.g. customer-owned Gateways, memory, custom browsers or code interpreters, skills, secrets). Sid and Condition are optional; null fields are omitted from the rendered policy."
  type = list(object({
    Sid       = optional(string)
    Effect    = string
    Action    = list(string)
    Resource  = list(string)
    Condition = optional(any)
  }))
  default = []
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

resource "random_id" "unique_suffix" {
  byte_length = 4
}

locals {
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition
  region     = data.aws_region.current.region

  # Capped at 31 characters so the suffix keeps the deployed Harness name
  # within its 40-character limit.
  harness_name_prefix = "MyHarness"
  harness_name        = "\${local.harness_name_prefix}_\${random_id.unique_suffix.hex}"

  # Set var.model_resource_arns to narrow the default model access.
  model_resource_arns = var.model_resource_arns != null ? var.model_resource_arns : [
    "arn:\${local.partition}:bedrock:*::foundation-model/*",
    "arn:\${local.partition}:bedrock:\${local.region}:\${local.account_id}:*",
  ]
}

resource "aws_iam_role" "execution_role" {
  name = "\${local.harness_name_prefix}-HarnessRole-\${random_id.unique_suffix.hex}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "bedrock-agentcore.amazonaws.com"
      }
      Action = "sts:AssumeRole"
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = local.account_id
        }
        ArnLike = {
          "aws:SourceArn" = "arn:\${local.partition}:bedrock-agentcore:\${local.region}:\${local.account_id}:*"
        }
      }
    }]
  })
}

# Baseline permissions per the AgentCore Harness security guidance; extend for
# customer-owned resources via var.additional_execution_role_policy_statements.
# https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/harness-security.html
resource "aws_iam_role_policy" "execution_role" {
  name = "\${local.harness_name_prefix}-HarnessPolicy"
  role = aws_iam_role.execution_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      {
        Sid    = "BedrockModelInvocation"
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
        ]
        Resource = local.model_resource_arns
      },
      {
        #checkov:skip=CKV_AWS_355:EcrPublicTokenAccess requires a wildcard resource; ecr-public:GetAuthorizationToken has no resource-level permission
        Sid      = "EcrPublicTokenAccess"
        Effect   = "Allow"
        Action   = ["ecr-public:GetAuthorizationToken"]
        Resource = ["*"]
      },
      {
        #checkov:skip=CKV_AWS_355:StsForEcrPublicPull requires a wildcard resource; sts:GetServiceBearerToken has no resource-level permission
        Sid      = "StsForEcrPublicPull"
        Effect   = "Allow"
        Action   = ["sts:GetServiceBearerToken"]
        Resource = ["*"]
      },
      {
        #checkov:skip=CKV_AWS_355:XRayTracingAccess requires a wildcard resource; the X-Ray segment and sampling APIs have no resource-level permission
        #checkov:skip=CKV_AWS_290:XRayTracingAccess requires a wildcard resource; the X-Ray segment and sampling APIs have no resource-level permission
        Sid    = "XRayTracingAccess"
        Effect = "Allow"
        Action = [
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords",
          "xray:GetSamplingRules",
          "xray:GetSamplingTargets",
        ]
        Resource = ["*"]
      },
      {
        Sid    = "CloudWatchLogsGroup"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:DescribeLogStreams",
        ]
        Resource = [
          "arn:\${local.partition}:logs:\${local.region}:\${local.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*",
        ]
      },
      {
        Sid      = "CloudWatchLogsDescribeGroups"
        Effect   = "Allow"
        Action   = ["logs:DescribeLogGroups"]
        Resource = ["arn:\${local.partition}:logs:\${local.region}:\${local.account_id}:log-group:*"]
      },
      {
        Sid    = "CloudWatchLogsStream"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = [
          "arn:\${local.partition}:logs:\${local.region}:\${local.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*",
        ]
      },
      {
        #checkov:skip=CKV_AWS_355:CloudWatchMetricsPublish requires a wildcard resource; cloudwatch:PutMetricData is scoped by the namespace condition instead
        #checkov:skip=CKV_AWS_290:CloudWatchMetricsPublish requires a wildcard resource; cloudwatch:PutMetricData is scoped by the namespace condition instead
        Sid      = "CloudWatchMetricsPublish"
        Effect   = "Allow"
        Action   = ["cloudwatch:PutMetricData"]
        Resource = ["*"]
        Condition = {
          StringEquals = {
            "cloudwatch:namespace" = "bedrock-agentcore"
          }
        }
      },
      {
        Sid    = "AgentCoreWorkloadIdentity"
        Effect = "Allow"
        Action = [
          "bedrock-agentcore:GetWorkloadAccessToken",
          "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
        ]
        Resource = [
          "arn:\${local.partition}:bedrock-agentcore:\${local.region}:\${local.account_id}:workload-identity-directory/default",
          "arn:\${local.partition}:bedrock-agentcore:\${local.region}:\${local.account_id}:workload-identity-directory/default/workload-identity/harness_\${local.harness_name}-*",
        ]
      },
      # The service names the managed memory from the harness name plus a
      # generated suffix, so this scopes to that prefix.
      {
        Sid    = "AgentCoreManagedMemory"
        Effect = "Allow"
        Action = [
          "bedrock-agentcore:CreateEvent",
          "bedrock-agentcore:DeleteEvent",
          "bedrock-agentcore:GetEvent",
          "bedrock-agentcore:ListEvents",
          "bedrock-agentcore:RetrieveMemoryRecords",
        ]
        Resource = [
          "arn:\${local.partition}:bedrock-agentcore:\${local.region}:\${local.account_id}:memory/\${local.harness_name}-*",
        ]
      },
      {
        Sid    = "AgentCoreBrowserDefault"
        Effect = "Allow"
        Action = [
          "bedrock-agentcore:StartBrowserSession",
          "bedrock-agentcore:StopBrowserSession",
          "bedrock-agentcore:GetBrowserSession",
          "bedrock-agentcore:ListBrowserSessions",
          "bedrock-agentcore:UpdateBrowserStream",
          "bedrock-agentcore:ConnectBrowserAutomationStream",
          "bedrock-agentcore:ConnectBrowserLiveViewStream",
        ]
        Resource = [
          "arn:\${local.partition}:bedrock-agentcore:\${local.region}:aws:browser/*",
        ]
      },
      {
        Sid    = "AgentCoreCodeInterpreterDefault"
        Effect = "Allow"
        Action = [
          "bedrock-agentcore:StartCodeInterpreterSession",
          "bedrock-agentcore:StopCodeInterpreterSession",
          "bedrock-agentcore:GetCodeInterpreterSession",
          "bedrock-agentcore:ListCodeInterpreterSessions",
          "bedrock-agentcore:InvokeCodeInterpreter",
        ]
        Resource = [
          "arn:\${local.partition}:bedrock-agentcore:\${local.region}:aws:code-interpreter/*",
        ]
      },
      ], [
      # Null Sid/Condition fields are dropped from the rendered policy.
      for statement in var.additional_execution_role_policy_statements :
      { for key, value in statement : key => value if value != null }
    ])
  })
}

# Omitting authorizer_configuration uses IAM inbound authorization; add a
# custom_jwt_authorizer block to change that.
resource "aws_bedrockagentcore_harness" "this" {
  harness_name       = local.harness_name
  execution_role_arn = aws_iam_role.execution_role.arn
  allowed_tools      = var.allowed_tools

  model {
    bedrock_model_config {
      model_id = var.model_id
    }
  }

  # Read at plan time; the walk up from path.module reaches the workspace root.
  system_prompt {
    text = file("\${path.module}/../../../../../../../packages/my-harness/src/PROMPT.md")
  }

  depends_on = [aws_iam_role_policy.execution_role]
}

module "add_harness_arn_to_runtime_config" {
  source = "../../../core/runtime-config/entry"

  namespace = "agentcore"
  key       = "harnesses"
  value     = { "MyHarness" = aws_bedrockagentcore_harness.this.arn }
}

output "harness_id" {
  description = "ID of the Amazon Bedrock AgentCore Harness"
  value       = aws_bedrockagentcore_harness.this.harness_id
}

output "harness_arn" {
  description = "ARN of the Amazon Bedrock AgentCore Harness"
  value       = aws_bedrockagentcore_harness.this.arn
}

output "execution_role_arn" {
  description = "ARN of the IAM role assumed by the Harness"
  value       = aws_iam_role.execution_role.arn
}
`;

describe('terraform-harness-vpc-role-and-memory-grant migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('does nothing when no vended harness modules exist', async () => {
    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
  });

  it('adds the VPC variables, security group and network configuration', async () => {
    tree.write(APP_MODULE_FILE, oldAppModule);

    const result = await migration(tree);
    const contents = tree.read(APP_MODULE_FILE, 'utf-8')!;

    expect(contents).toContain('variable "enable_vpc"');
    expect(contents).toContain('variable "vpc_id"');
    expect(contents).toContain('variable "subnet_ids"');
    expect(contents).toContain(
      'error_message = "vpc_id and subnet_ids must be set when enable_vpc is true."',
    );

    // The security group and its 443-only egress rule
    expect(contents).toContain('resource "aws_security_group" "harness"');
    expect(contents).toContain(
      'resource "aws_vpc_security_group_egress_rule" "harness_https"',
    );
    expect(contents).toContain('from_port         = 443');

    // The network configuration is rendered only when enable_vpc is set
    expect(contents).toContain('dynamic "environment"');
    expect(contents).toContain('network_mode = "VPC"');
    expect(contents).toContain(
      'security_groups = [aws_security_group.harness[0].id]',
    );

    expect(contents).toContain('output "security_group_id"');
    expect(result.nextSteps).toEqual([]);
  });

  it('makes the generated role conditional on none being supplied', async () => {
    tree.write(APP_MODULE_FILE, oldAppModule);

    await migration(tree);
    const contents = tree.read(APP_MODULE_FILE, 'utf-8')!;

    expect(contents).toContain('variable "create_execution_role"');
    expect(contents).toContain('variable "execution_role_arn"');
    expect(contents).toContain(
      'execution_role_arn = var.create_execution_role ? aws_iam_role.execution_role[0].arn : var.execution_role_arn',
    );

    // Both the role and its baseline policy are skipped for a supplied role
    expect(contents).toMatch(
      /resource "aws_iam_role" "execution_role" \{\s*\n\s*count = var\.create_execution_role \? 1 : 0/,
    );
    expect(contents).toMatch(
      /resource "aws_iam_role_policy" "execution_role" \{\s*\n\s*count = var\.create_execution_role \? 1 : 0/,
    );
    expect(contents).toContain('role = aws_iam_role.execution_role[0].id');

    // The harness and the output both follow whichever role is in use
    expect(contents).toContain('execution_role_arn = local.execution_role_arn');
    expect(contents).toContain('value       = local.execution_role_arn');
  });

  it('exposes the native fields as variables', async () => {
    tree.write(APP_MODULE_FILE, oldAppModule);

    await migration(tree);
    const contents = tree.read(APP_MODULE_FILE, 'utf-8')!;

    for (const name of [
      'allowed_tools',
      'memory',
      'environment_variables',
      'max_iterations',
      'timeout_seconds',
    ]) {
      expect(contents).toContain(`variable "${name}"`);
    }

    expect(contents).toContain('allowed_tools         = var.allowed_tools');
    expect(contents).toContain(
      'environment_variables = var.environment_variables',
    );
    expect(contents).toContain('max_iterations        = var.max_iterations');
    expect(contents).toContain('timeout_seconds       = var.timeout_seconds');

    // memory is rendered as a dynamic block covering all three variants
    expect(contents).toContain('dynamic "memory"');
    expect(contents).toContain('dynamic "managed_memory_configuration"');
    expect(contents).toContain('dynamic "agentcore_memory_configuration"');
    expect(contents).toContain('dynamic "disabled"');
  });

  it('re-scopes the managed-memory grant to the service-assigned ARN', async () => {
    tree.write(APP_MODULE_FILE, oldAppModule);

    // The name-prefix guess is what the module granted before
    expect(oldAppModule).toContain('memory/${local.harness_name}-*');

    await migration(tree);
    const contents = tree.read(APP_MODULE_FILE, 'utf-8')!;

    // The guess is gone, replaced by the ARN the service assigns
    expect(contents).not.toContain('memory/${local.harness_name}-*');
    expect(contents).toContain(
      'aws_bedrockagentcore_harness.this.memory_actual[0].managed_memory_configuration[0].arn',
    );

    // Granted only when the module created both the role and the memory
    expect(contents).toContain(
      'resource "aws_iam_role_policy" "managed_memory"',
    );
    expect(contents).toContain(
      'count = var.create_execution_role && local.has_managed_memory ? 1 : 0',
    );
    expect(contents).toContain(
      'has_managed_memory = var.memory == null || var.memory.managed_memory_configuration != null',
    );

    // The grant is no longer part of the baseline policy
    const baselinePolicy = contents.slice(
      contents.indexOf('resource "aws_iam_role_policy" "execution_role"'),
      contents.indexOf('# Security group for the Harness'),
    );
    expect(baselinePolicy).not.toContain('AgentCoreManagedMemory');
  });

  it('leaves the other baseline statements untouched', async () => {
    tree.write(APP_MODULE_FILE, oldAppModule);

    await migration(tree);
    const contents = tree.read(APP_MODULE_FILE, 'utf-8')!;

    for (const sid of [
      'BedrockModelInvocation',
      'EcrPublicTokenAccess',
      'StsForEcrPublicPull',
      'XRayTracingAccess',
      'CloudWatchLogsGroup',
      'CloudWatchLogsDescribeGroups',
      'CloudWatchLogsStream',
      'CloudWatchMetricsPublish',
      'AgentCoreWorkloadIdentity',
      'AgentCoreBrowserDefault',
      'AgentCoreCodeInterpreterDefault',
    ]) {
      expect(contents).toContain(`"${sid}"`);
    }

    // And the module's existing configuration survives
    expect(contents).toContain('variable "model_id"');
    expect(contents).toContain('module "add_harness_arn_to_runtime_config"');
    expect(contents).toContain('output "harness_arn"');
    expect(contents).toContain('output "harness_id"');
  });

  it('skips and reports a module whose baseline policy was edited', async () => {
    // The baseline policy is replaced whole, so an added statement would be
    // discarded. Such a module is left alone instead.
    tree.write(
      APP_MODULE_FILE,
      oldAppModule.replace(
        '      {\n        Sid    = "AgentCoreBrowserDefault"',
        '      {\n        Sid      = "MyOwnStatement"\n        Effect   = "Allow"\n        Action   = ["s3:GetObject"]\n        Resource = ["arn:aws:s3:::my-bucket/*"]\n      },\n      {\n        Sid    = "AgentCoreBrowserDefault"',
      ),
    );

    const result = await migration(tree);
    const contents = tree.read(APP_MODULE_FILE, 'utf-8')!;

    expect(contents).toContain('"MyOwnStatement"');
    expect(contents).not.toContain('variable "enable_vpc"');
    expect(result.nextSteps).toEqual([divergedMessage(APP_MODULE_FILE)]);
  });

  it('migrates every app module directory found', async () => {
    tree.write(APP_MODULE_FILE, oldAppModule);
    tree.write(APP_MODULE_FILE_2, oldAppModule);

    await migration(tree);

    for (const file of [APP_MODULE_FILE, APP_MODULE_FILE_2]) {
      expect(tree.read(file, 'utf-8')!).toContain('variable "enable_vpc"');
    }
  });

  it('is idempotent', async () => {
    tree.write(APP_MODULE_FILE, oldAppModule);

    await migration(tree);
    const afterFirst = tree.read(APP_MODULE_FILE, 'utf-8');

    await migration(tree);

    expect(tree.read(APP_MODULE_FILE, 'utf-8')).toEqual(afterFirst);
  });

  it('leaves an already-migrated module untouched', async () => {
    tree.write(APP_MODULE_FILE, oldAppModule);
    await migration(tree);
    const migrated = tree.read(APP_MODULE_FILE, 'utf-8')!;

    tree.write(APP_MODULE_FILE, migrated);
    const result = await migration(tree);

    expect(tree.read(APP_MODULE_FILE, 'utf-8')).toEqual(migrated);
    expect(result.nextSteps).toEqual([]);
  });

  it('skips and reports a diverged app module', async () => {
    tree.write(
      APP_MODULE_FILE,
      'resource "aws_bedrockagentcore_harness" "mine" {\n  harness_name = "custom"\n}\n',
    );

    const result = await migration(tree);

    expect(tree.read(APP_MODULE_FILE, 'utf-8')).not.toContain(
      'variable "enable_vpc"',
    );
    expect(result.nextSteps).toEqual([divergedMessage(APP_MODULE_FILE)]);
  });

  it('converges on what the generator writes today', async () => {
    // The migration's contract: an upgraded workspace ends up with the module a
    // workspace generated today would have.
    tree.write(APP_MODULE_FILE, oldAppModule);
    await migration(tree);

    const fresh = createTreeUsingTsSolutionSetup();
    await agentcoreHarnessGenerator(fresh, {
      name: 'my-harness',
      iac: 'terraform',
    });

    // Provider version pins are the `sync-vended-versions` migration's job, so
    // the fixture's are left as they were.
    const withoutVersionPins = (contents: string) =>
      contents.replace(/^(\s*version\s*=\s*)".*"$/gm, '$1"<pinned>"');

    expect(withoutVersionPins(tree.read(APP_MODULE_FILE, 'utf-8')!)).toEqual(
      withoutVersionPins(fresh.read(APP_MODULE_FILE, 'utf-8')!),
    );
  });

  it('snapshots the migrated module', async () => {
    tree.write(APP_MODULE_FILE, oldAppModule);

    await migration(tree);

    expect(tree.read(APP_MODULE_FILE, 'utf-8')).toMatchSnapshot();
  });
});
