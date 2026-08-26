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
  captureAllGritQL,
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
 * Bring each vended Terraform AgentCore Harness app module
 * (`app/harnesses/<name>/<name>.tf`) up to the shape the generator now writes:
 *
 * - `enable_vpc` / `vpc_id` / `subnet_ids` with a security group and a 443-only
 *   egress rule, so the Harness can reach private resources.
 * - `create_execution_role` / `execution_role_arn`, so an existing role can be
 *   supplied. The generated role and its baseline policy are then not created.
 * - `allowed_tools`, `memory`, `environment_variables`, `max_iterations` and
 *   `timeout_seconds` as variables rather than HCL edits.
 * - The managed-memory grant moved to its own policy, made conditional and
 *   re-scoped from a name-prefix guess to the ARN the service assigns.
 *
 * These files are generated with `KeepExisting`, so an upgraded workspace keeps
 * the older module until this runs. Modules that have diverged from the
 * generated shape are left untouched and reported via `nextSteps`.
 */

const TERRAFORM_HARNESS_APP_DIR = `${PACKAGES_DIR}/${SHARED_TERRAFORM_DIR}/src/app/harnesses`;

const hcl = (pattern: string) => `language hcl\n${pattern}`;

const divergedMessage = (filePath: string) =>
  `${filePath}: has diverged from the generated shape - left untouched. To pick up VPC support, a supplied execution role, the allowed_tools/memory/environment_variables/max_iterations/timeout_seconds variables and the corrected managed-memory grant, compare it against the agentcore-harness generator's Terraform template and apply the parts you want.`;

/** Variables added ahead of the existing `model_resource_arns` variable. */
const NEW_VARIABLES_TEXT = `variable "allowed_tools" {
  description = "Tools the Harness may use, e.g. [\\"@builtin\\"] or narrower patterns such as [\\"@builtin/file_operations\\"]. Deploys with no tools when null."
  type        = list(string)
  default     = null
}

variable "memory" {
  description = "Memory configuration for the Harness. Null leaves the service to provision managed memory with default strategies. Set exactly one field: managed_memory_configuration to tune that managed memory, agentcore_memory_configuration to use a memory resource you own, or disabled to turn memory off."
  type = object({
    managed_memory_configuration = optional(object({
      strategies            = optional(set(string))
      event_expiry_duration = optional(number)
      encryption_key_arn    = optional(string)
    }))
    agentcore_memory_configuration = optional(object({
      arn            = string
      actor_id       = optional(string)
      messages_count = optional(number)
    }))
    disabled = optional(bool, false)
  })
  default = null

  validation {
    condition = var.memory == null || length([
      for configured in [
        var.memory.managed_memory_configuration != null,
        var.memory.agentcore_memory_configuration != null,
        var.memory.disabled,
      ] : configured if configured
    ]) == 1
    error_message = "Set exactly one of memory.managed_memory_configuration, memory.agentcore_memory_configuration or memory.disabled."
  }
}

variable "environment_variables" {
  description = "Environment variables available to the Harness."
  type        = map(string)
  default     = null
  sensitive   = true
}

variable "max_iterations" {
  description = "Maximum agent loop iterations per invocation. Uses the service default when null."
  type        = number
  default     = null
}

variable "timeout_seconds" {
  description = "Maximum seconds an invocation may run. Uses the service default when null."
  type        = number
  default     = null
}

variable "create_execution_role" {
  description = "Create the execution role with the baseline permissions below. Set false alongside execution_role_arn to use a role you already have, which is then used as-is."
  type        = bool
  default     = true

  validation {
    condition     = var.create_execution_role || var.execution_role_arn != null
    error_message = "execution_role_arn must be set when create_execution_role is false."
  }

  validation {
    condition = var.create_execution_role || (
      var.model_resource_arns == null && length(var.additional_execution_role_policy_statements) == 0
    )
    error_message = "model_resource_arns and additional_execution_role_policy_statements configure the generated execution role, which is not created when create_execution_role is false. Grant those permissions on the supplied role instead."
  }
}

variable "execution_role_arn" {
  description = "ARN of an existing IAM role for the Harness to assume. Requires create_execution_role = false."
  type        = string
  default     = null
}`;

/** VPC and tag variables added after `additional_execution_role_policy_statements`. */
const VPC_VARIABLES_TEXT = `# VPC Configuration (optional)
variable "enable_vpc" {
  description = "Run the Harness inside a VPC so it can reach private resources. Set alongside vpc_id/subnet_ids."
  type        = bool
  default     = false
}

variable "vpc_id" {
  description = "VPC ID to run the Harness in. Required when enable_vpc is true."
  type        = string
  default     = null

  validation {
    condition     = !var.enable_vpc || (var.vpc_id != null && var.subnet_ids != null)
    error_message = "vpc_id and subnet_ids must be set when enable_vpc is true."
  }
}

variable "subnet_ids" {
  description = "Subnet IDs to run the Harness in. Required when enable_vpc is true."
  type        = list(string)
  default     = null
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}`;

/** Locals added to the module's existing `locals` block. */
const NEW_LOCALS_TEXT = `  execution_role_arn = var.create_execution_role ? aws_iam_role.execution_role[0].arn : var.execution_role_arn

  # The service provisions managed memory unless var.memory redirects it
  # elsewhere or turns it off.
  has_managed_memory = var.memory == null || var.memory.managed_memory_configuration != null`;

/** Security group and egress rule, added before the Harness resource. */
const SECURITY_GROUP_TEXT = `# Security group for the Harness, used when running inside a VPC
resource "aws_security_group" "harness" {
  count = var.enable_vpc ? 1 : 0

  #checkov:skip=CKV2_AWS_5:Attached to the Harness via its network configuration; Checkov cannot resolve this reference
  name_prefix = "\${local.harness_name_prefix}-harness-"
  description = "Security group for the \${local.harness_name_prefix} Harness"
  vpc_id      = var.vpc_id
  tags        = var.tags
}

resource "aws_vpc_security_group_egress_rule" "harness_https" {
  count = var.enable_vpc ? 1 : 0

  security_group_id = aws_security_group.harness[0].id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  description       = "Allow outbound HTTPS to AWS service endpoints"
}`;

/** Native fields and the VPC network configuration, added to the Harness resource. */
const HARNESS_FIELDS_TEXT = `  allowed_tools         = var.allowed_tools
  environment_variables = var.environment_variables
  max_iterations        = var.max_iterations
  timeout_seconds       = var.timeout_seconds`;

const HARNESS_BLOCKS_TEXT = `  dynamic "memory" {
    for_each = var.memory != null ? [var.memory] : []
    content {
      dynamic "managed_memory_configuration" {
        for_each = memory.value.managed_memory_configuration != null ? [memory.value.managed_memory_configuration] : []
        content {
          strategies            = managed_memory_configuration.value.strategies
          event_expiry_duration = managed_memory_configuration.value.event_expiry_duration
          encryption_key_arn    = managed_memory_configuration.value.encryption_key_arn
        }
      }

      dynamic "agentcore_memory_configuration" {
        for_each = memory.value.agentcore_memory_configuration != null ? [memory.value.agentcore_memory_configuration] : []
        content {
          arn            = agentcore_memory_configuration.value.arn
          actor_id       = agentcore_memory_configuration.value.actor_id
          messages_count = agentcore_memory_configuration.value.messages_count
        }
      }

      dynamic "disabled" {
        for_each = memory.value.disabled ? [1] : []
        content {}
      }
    }
  }

  dynamic "environment" {
    for_each = var.enable_vpc ? [1] : []
    content {
      agentcore_runtime_environment {
        network_configuration {
          network_mode = "VPC"
          network_mode_config {
            security_groups = [aws_security_group.harness[0].id]
            subnets         = var.subnet_ids
          }
        }
      }
    }
  }

  tags = var.tags`;

/** The managed-memory grant, as its own policy scoped to the assigned ARN. */
const MANAGED_MEMORY_POLICY_TEXT = `# Scoped to the memory ARN the service assigns, which is only readable after the
# Harness exists, so this is a policy of its own rather than a baseline
# statement. Skipped when the Harness uses a role or memory the module did not
# create.
resource "aws_iam_role_policy" "managed_memory" {
  count = var.create_execution_role && local.has_managed_memory ? 1 : 0

  name = "\${local.harness_name_prefix}-HarnessManagedMemoryPolicy"
  role = aws_iam_role.execution_role[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
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
        aws_bedrockagentcore_harness.this.memory_actual[0].managed_memory_configuration[0].arn,
      ]
    }]
  })
}`;

const SECURITY_GROUP_OUTPUT_TEXT = `output "security_group_id" {
  description = "Security group ID of the Harness, for use in ingress rules on resources it must reach (e.g. a database). Null unless enable_vpc is true."
  value       = var.enable_vpc ? aws_security_group.harness[0].id : null
}`;

/**
 * The baseline policy, replaced whole: the managed-memory statement leaves it
 * for a policy of its own, and the resource gains a `count`. Rewriting the
 * statement list in place would strand the comment and comma around the
 * statement being removed.
 */
const BASELINE_POLICY_TEXT = `resource "aws_iam_role_policy" "execution_role" {
  count = var.create_execution_role ? 1 : 0

  name = "\${local.harness_name_prefix}-HarnessPolicy"
  role = aws_iam_role.execution_role[0].id

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
}`;

/**
 * Every shape the migration rewrites, so a module missing any of them is
 * reported rather than half-migrated.
 */
const REQUIRED_SHAPES = [
  '`variable "model_resource_arns" { $_ }`',
  '`variable "additional_execution_role_policy_statements" { $_ }`',
  '`locals { $_ }`',
  '`resource "aws_iam_role" "execution_role" { $_ }`',
  '`resource "aws_iam_role_policy" "execution_role" { $_ }`',
  '`resource "aws_bedrockagentcore_harness" "this" { $_ }`',
  '`output "execution_role_arn" { $_ }`',
];

/**
 * The baseline policy is replaced whole, so it is only safe to touch when it
 * still carries exactly the statements the generator wrote. Any addition,
 * removal or reordering means the user has edited it, and the replacement would
 * discard that.
 */
const BASELINE_SIDS = [
  'BedrockModelInvocation',
  'EcrPublicTokenAccess',
  'StsForEcrPublicPull',
  'XRayTracingAccess',
  'CloudWatchLogsGroup',
  'CloudWatchLogsDescribeGroups',
  'CloudWatchLogsStream',
  'CloudWatchMetricsPublish',
  'AgentCoreWorkloadIdentity',
  'AgentCoreManagedMemory',
  'AgentCoreBrowserDefault',
  'AgentCoreCodeInterpreterDefault',
];

/**
 * Whether the module's baseline policy still carries exactly the generated
 * statements, in order. Sids are read from the whole file: the only other `Sid`
 * is the `optional(string)` field of the additional-statements variable, which
 * carries no string literal and so is filtered out.
 */
const hasUneditedBaselinePolicy = async (
  tree: Tree,
  filePath: string,
): Promise<boolean> => {
  const sids = (await captureAllGritQL(tree, filePath, hcl('`Sid = $sid`')))
    .map((text) => /=\s*"([^"]+)"/.exec(text)?.[1])
    .filter((sid): sid is string => sid !== undefined);
  return (
    sids.length === BASELINE_SIDS.length &&
    sids.every((sid, index) => sid === BASELINE_SIDS[index])
  );
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  if (!tree.exists(TERRAFORM_HARNESS_APP_DIR)) {
    return { nextSteps }; // This workspace has no Terraform harness modules.
  }

  for (const dirName of tree.children(TERRAFORM_HARNESS_APP_DIR)) {
    const filePath = joinPathFragments(
      TERRAFORM_HARNESS_APP_DIR,
      dirName,
      `${dirName}.tf`,
    );
    if (!tree.exists(filePath)) {
      continue; // Not a harness app module directory.
    }

    if (
      await matchGritQL(tree, filePath, hcl('`variable "enable_vpc" { $_ }`'))
    ) {
      continue; // Already migrated.
    }

    const shapeChecks = await Promise.all(
      REQUIRED_SHAPES.map((shape) => matchGritQL(tree, filePath, hcl(shape))),
    );
    if (
      shapeChecks.includes(false) ||
      !(await hasUneditedBaselinePolicy(tree, filePath))
    ) {
      nextSteps.push(divergedMessage(filePath));
      continue;
    }

    // Variables, ahead of the model/role variables they sit beside in the
    // template.
    await insertViaGritQL(
      tree,
      filePath,
      hcl(
        `\`variable "model_resource_arns" { $body }\` => \`${GRIT_INSERT_PLACEHOLDER}\n\nvariable "model_resource_arns" {\n  $body\n}\``,
      ),
      NEW_VARIABLES_TEXT,
    );
    await insertViaGritQL(
      tree,
      filePath,
      hcl(
        `\`variable "additional_execution_role_policy_statements" { $body }\` => \`variable "additional_execution_role_policy_statements" {\n  $body\n}\n\n${GRIT_INSERT_PLACEHOLDER}\``,
      ),
      VPC_VARIABLES_TEXT,
    );

    // Locals resolving the role ARN and whether managed memory applies.
    await insertViaGritQL(
      tree,
      filePath,
      hcl(
        `\`locals { $body }\` => \`locals {\n  $body\n\n${GRIT_INSERT_PLACEHOLDER}\n}\``,
      ),
      NEW_LOCALS_TEXT,
    );

    // The role becomes conditional on none being supplied, so it is indexed
    // wherever it is referenced, and gains the shared tags.
    await applyGritQL(
      tree,
      filePath,
      hcl(
        '`resource "aws_iam_role" "execution_role" { $body }` => `resource "aws_iam_role" "execution_role" {\n  count = var.create_execution_role ? 1 : 0\n\n  $body\n\n  tags = var.tags\n}`',
      ),
    );

    // The baseline policy is replaced whole, dropping the managed-memory
    // statement, which becomes a policy of its own scoped to the assigned ARN.
    await insertViaGritQL(
      tree,
      filePath,
      hcl(
        `\`resource "aws_iam_role_policy" "execution_role" { $_ }\` => \`${GRIT_INSERT_PLACEHOLDER}\``,
      ),
      BASELINE_POLICY_TEXT,
    );

    // Native fields and the VPC network configuration on the Harness resource.
    await insertViaGritQL(
      tree,
      filePath,
      hcl(
        `\`execution_role_arn = aws_iam_role.execution_role.arn\` => \`execution_role_arn = local.execution_role_arn\n\n${GRIT_INSERT_PLACEHOLDER}\``,
      ),
      HARNESS_FIELDS_TEXT,
    );
    // Ahead of `depends_on`, which the resource ends with.
    await insertViaGritQL(
      tree,
      filePath,
      hcl(
        `\`depends_on = [aws_iam_role_policy.execution_role]\` => \`${GRIT_INSERT_PLACEHOLDER}\n\n  depends_on = [aws_iam_role_policy.execution_role]\``,
      ),
      // The placeholder already sits at the block's indentation.
      HARNESS_BLOCKS_TEXT.replace(/^ {2}/, ''),
    );

    // Security group ahead of the Harness resource, and the managed-memory
    // policy after it, since it reads an attribute of the deployed Harness.
    // Anchored on the comment introducing the resource so it stays attached.
    await insertViaGritQL(
      tree,
      filePath,
      hcl(
        `\`# Omitting authorizer_configuration uses IAM inbound authorization; add a\` => \`${GRIT_INSERT_PLACEHOLDER}\n\n# Omitting authorizer_configuration uses IAM inbound authorization; add a\``,
      ),
      SECURITY_GROUP_TEXT,
    );
    await insertViaGritQL(
      tree,
      filePath,
      hcl(
        `\`resource "aws_bedrockagentcore_harness" "this" { $body }\` => \`resource "aws_bedrockagentcore_harness" "this" {\n  $body\n}\n\n${GRIT_INSERT_PLACEHOLDER}\``,
      ),
      MANAGED_MEMORY_POLICY_TEXT,
    );

    // The role ARN output follows whichever role is in use, and the security
    // group is exposed for ingress rules on resources the Harness reaches.
    await applyGritQL(
      tree,
      filePath,
      hcl(
        '`output "execution_role_arn" { $_ }` => `output "execution_role_arn" {\n  description = "ARN of the IAM role assumed by the Harness, whether generated or supplied via var.execution_role_arn"\n  value       = local.execution_role_arn\n}`',
      ),
    );
    await insertViaGritQL(
      tree,
      filePath,
      hcl(
        `\`output "execution_role_arn" { $body }\` => \`output "execution_role_arn" {\n  $body\n}\n\n${GRIT_INSERT_PLACEHOLDER}\``,
      ),
      SECURITY_GROUP_OUTPUT_TEXT,
    );
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
