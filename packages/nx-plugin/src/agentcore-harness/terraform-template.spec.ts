/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import { TERRAFORM_VERSIONS } from '../utils/versions';
import { agentcoreHarnessGenerator } from './generator';
import {
  DEFAULT_HARNESS_MODEL_ID,
  DEFAULT_HARNESS_SYSTEM_PROMPT,
} from './resolve-options';

/**
 * Terraform Harness template contract tests.
 *
 * These tests assert the rendered module CONTENT against the pinned AWS
 * provider 6.54.0 `aws_bedrockagentcore_harness` contract (block/attribute
 * names verified against the published provider schema when the template
 * was implemented).
 *
 * Live `terraform fmt -check` / `terraform validate` execution
 * (requirements 6.11, 14.6) is deliberately NOT performed in this suite:
 * the repository has no committed in-plugin terraform-CLI test pattern (no
 * plugin spec shells out to terraform), because a terraform binary is not
 * guaranteed in unit-test CI. CLI validation of the generated module runs
 * in two places instead:
 *
 * 1. `terraform-validate.spec.ts` (beside this file) runs the real
 *    `terraform fmt -check` and `terraform validate` against rendered
 *    modules whenever a terraform CLI is available, and skips with an
 *    explanatory message otherwise.
 * 2. The generated-workspace validation layer (Generator Matrix and
 *    terraform smoke tests) exercises the generated terraform project's
 *    `fmt` and `validate` Nx targets in real workspaces.
 *
 * No `terraform plan` or `terraform apply` is ever run.
 */

const TF_MODULE_PATH =
  'packages/common/terraform/src/app/harnesses/my-harness/my-harness.tf';

/** The 12 Baseline Permission SIDs from the design, in template order. */
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
] as const;

const countOccurrences = (content: string, needle: string): number =>
  content.split(needle).length - 1;

/**
 * Extract a complete top-level HCL block (`variable "x" { ... }`,
 * `resource "t" "n" { ... }`, ...) by brace counting from the block header.
 * Every brace in the template (including `${...}` interpolations and
 * comment examples) is balanced, so brace counting yields the exact block.
 */
const tfBlock = (module: string, header: string): string => {
  const start = module.indexOf(header);
  expect(start, `block '${header}' not found`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = module.indexOf('{', start); i < module.length; i++) {
    if (module[i] === '{') {
      depth++;
    } else if (module[i] === '}') {
      depth--;
      if (depth === 0) {
        return module.slice(start, i + 1);
      }
    }
  }
  throw new Error(`unterminated block '${header}'`);
};

/** Extract the raw `default = ...` expression of one Terraform variable. */
const tfVariableDefault = (module: string, variable: string): string => {
  const match = tfBlock(module, `variable "${variable}"`).match(
    /default\s*=\s*(.+)/,
  );
  return match?.[1]?.trim() ?? '';
};

interface ParsedTfStatement {
  actions: string[];
  /** Raw Resource expression: `local.<name>` or a list literal. */
  resourceRaw: string;
  /** Statement text after Resource (contains Condition when present). */
  conditionRaw?: string;
}

/**
 * Parse every baseline statement of the `jsonencode`d execution-role policy
 * into its SID, exact action list, raw resource expression, and raw
 * condition, so tests assert exact per-statement content rather than token
 * presence anywhere in the file (same string-level approach as the CDK
 * template spec's PolicyStatement parser).
 */
const parseBaselineStatements = (
  module: string,
): Record<string, ParsedTfStatement> => {
  const start = module.indexOf('Statement = concat([');
  const end = module.indexOf('], [');
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const baseline = module.slice(start, end);

  const statements: Record<string, ParsedTfStatement> = {};
  // Each part spans one statement: from its Sid up to the next Sid.
  for (const part of baseline.split(/\bSid\s*=\s*/).slice(1)) {
    const sid = part.match(/^"([^"]+)"/)?.[1];
    if (!sid) {
      continue;
    }
    const actionsSection = part.match(/Action\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? '';
    const conditionIdx = part.indexOf('Condition');
    statements[sid] = {
      actions: [...actionsSection.matchAll(/"([^"]+)"/g)].map(
        (match) => match[1],
      ),
      resourceRaw:
        part.match(/Resource\s*=\s*(local\.\w+|\[[\s\S]*?\])/)?.[1] ?? '',
      conditionRaw: conditionIdx >= 0 ? part.slice(conditionIdx) : undefined,
    };
  }
  return statements;
};

/** Entries (quoted strings, incl. interpolations) of an HCL list literal. */
const resourceEntries = (resourceRaw: string): string[] =>
  [...resourceRaw.matchAll(/"[^"]*"/g)].map((match) => match[0]);

describe('agentcore-harness Terraform template contract', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  describe('generated with defaults', () => {
    let module: string;

    beforeEach(async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'terraform',
      });
      module = tree.read(TF_MODULE_PATH, 'utf-8')!;
    });

    // Requirements 6.3, 6.4, 13.5: exact centralized provider pins.
    it('pins the aws and random providers to the exact centralized versions', () => {
      // The centralized registry itself carries the required exact pin.
      expect(TERRAFORM_VERSIONS.aws).toBe('6.55.0');

      const providers = tfBlock(module, 'required_providers');
      expect(providers).toContain('source  = "hashicorp/aws"');
      expect(providers).toContain(`version = "${TERRAFORM_VERSIONS.aws}"`);
      expect(providers).toContain('source  = "hashicorp/random"');
      expect(providers).toContain(`version = "${TERRAFORM_VERSIONS.random}"`);
      // Exact pins only - no range operators on provider versions.
      expect(providers).not.toMatch(/version\s*=\s*"[^"]*[~><^]/);
      // Exactly the two providers the module uses.
      expect(countOccurrences(providers, 'source ')).toBe(2);
    });

    // Requirements 4.8, 6.2: the native resource owns the lifecycle - no
    // imperative scripts, custom SDK calls, or Control Plane operations.
    it('manages the Harness with the native resource and no imperative lifecycle', () => {
      expect(
        countOccurrences(
          module,
          'resource "aws_bedrockagentcore_harness" "this"',
        ),
      ).toBe(1);

      expect(module).not.toContain('local-exec');
      expect(module).not.toContain('remote-exec');
      expect(module).not.toContain('null_resource');
      expect(module).not.toContain('provisioner');
      expect(module).not.toContain('@aws-sdk/');
      expect(module).not.toMatch(
        /CreateHarness|GetHarness|UpdateHarness|DeleteHarness|ListHarnesses/,
      );

      // The Harness waits for the role policy so first invocations do not
      // race the baseline permissions.
      const resource = tfBlock(
        module,
        'resource "aws_bedrockagentcore_harness" "this"',
      );
      expect(resource).toContain(
        'depends_on = [aws_iam_role_policy.execution_role]',
      );
    });

    // Requirements 6.6, 6.8: the six MVP variables plus the two extension
    // variables, and nothing else.
    it('exposes exactly the six MVP variables plus the two extension variables', () => {
      for (const variable of [
        'model_id',
        'system_prompt',
        'allowed_tools',
        'max_iterations',
        'max_tokens',
        'timeout_seconds',
        'model_resource_arns',
        'additional_execution_role_policy_statements',
      ]) {
        expect(module).toContain(`variable "${variable}"`);
      }
      expect(countOccurrences(module, '\nvariable "')).toBe(8);
    });

    it('marks system_prompt sensitive', () => {
      const systemPrompt = tfBlock(module, 'variable "system_prompt"');
      expect(systemPrompt).toMatch(/sensitive\s*=\s*true/);
    });

    // Requirement 6.6 (mirrors schema predicates 1.12): 1-64 entries, each
    // containing at least one non-whitespace character.
    it('validates allowed_tools bounds and non-whitespace entries', () => {
      const allowedTools = tfBlock(module, 'variable "allowed_tools"');
      expect(allowedTools).toContain(
        'length(var.allowed_tools) >= 1 && length(var.allowed_tools) <= 64',
      );
      expect(allowedTools).toContain(
        'alltrue([for tool in var.allowed_tools : length(trimspace(tool)) > 0])',
      );
    });

    // Requirements 3.2, 3.3, 6.6: nullable limits validated positive only
    // when non-null.
    it.each(['max_iterations', 'max_tokens', 'timeout_seconds'])(
      'validates %s as positive when non-null',
      (limit) => {
        const block = tfBlock(module, `variable "${limit}"`);
        expect(block).toMatch(/type\s*=\s*number/);
        expect(block).toContain(
          `var.${limit} == null ? true : var.${limit} > 0`,
        );
      },
    );

    // Requirement 7.2: configurable model access with the two default
    // resource patterns when the caller does not narrow it.
    it('types model_resource_arns as a nullable set(string) with the default Bedrock patterns', () => {
      const variable = tfBlock(module, 'variable "model_resource_arns"');
      expect(variable).toMatch(/type\s*=\s*set\(string\)/);
      expect(tfVariableDefault(module, 'model_resource_arns')).toBe('null');

      // The local falls back to the two baseline patterns.
      expect(module).toContain(
        'model_resource_arns = var.model_resource_arns != null ? var.model_resource_arns : [',
      );
      expect(module).toContain(
        '"arn:${local.partition}:bedrock:*::foundation-model/*"',
      );
      expect(module).toContain(
        '"arn:${local.partition}:bedrock:${local.region}:${local.account_id}:*"',
      );
    });

    // Requirement 6.8: structured extension statements with optional SID
    // and Condition, appended without altering baseline statements.
    it('exposes the structured additional-statements variable with optional Sid and Condition', () => {
      const variable = tfBlock(
        module,
        'variable "additional_execution_role_policy_statements"',
      );
      expect(variable).toMatch(
        /type = list\(object\(\{\s*Sid\s*=\s*optional\(string\)\s*Effect\s*=\s*string\s*Action\s*=\s*list\(string\)\s*Resource\s*=\s*list\(string\)\s*Condition\s*=\s*optional\(any\)\s*\}\)\)/,
      );
      expect(
        tfVariableDefault(
          module,
          'additional_execution_role_policy_statements',
        ),
      ).toBe('[]');

      // Statements are concatenated after the baseline, with null optional
      // fields stripped so rendered JSON has only the keys each statement
      // sets.
      expect(module).toContain('Statement = concat([');
      expect(module).toContain(
        'for statement in var.additional_execution_role_policy_statements :',
      );
      expect(module).toContain(
        '{ for key, value in statement : key => value if value != null }',
      );
    });

    // Requirements 3.1, 3.3, 6.7: variable defaults equal the
    // generator-resolved values; omitted limits are null.
    it('renders the exact creation defaults as variable defaults', () => {
      expect(tfVariableDefault(module, 'model_id')).toBe(
        `"${DEFAULT_HARNESS_MODEL_ID}"`,
      );
      expect(tfVariableDefault(module, 'system_prompt')).toBe(
        `"${DEFAULT_HARNESS_SYSTEM_PROMPT}"`,
      );
      expect(tfVariableDefault(module, 'allowed_tools')).toBe('["@builtin"]');
      expect(tfVariableDefault(module, 'max_iterations')).toBe('null');
      expect(tfVariableDefault(module, 'max_tokens')).toBe('null');
      expect(tfVariableDefault(module, 'timeout_seconds')).toBe('null');
    });

    // Requirements 3.5, 3.6: every MVP resource attribute references its
    // variable, so caller module arguments override the generated defaults
    // through normal Terraform variable evaluation.
    it('wires every MVP resource attribute to its variable so caller arguments take precedence', () => {
      const resource = tfBlock(
        module,
        'resource "aws_bedrockagentcore_harness" "this"',
      );
      expect(resource).toMatch(
        /model\s*\{\s*bedrock_model_config\s*\{\s*model_id\s*=\s*var\.model_id/,
      );
      expect(resource).toMatch(
        /system_prompt\s*\{\s*text\s*=\s*var\.system_prompt/,
      );
      expect(resource).toMatch(/allowed_tools\s*=\s*var\.allowed_tools/);
      expect(resource).toMatch(/max_iterations\s*=\s*var\.max_iterations/);
      expect(resource).toMatch(/max_tokens\s*=\s*var\.max_tokens/);
      expect(resource).toMatch(/timeout_seconds\s*=\s*var\.timeout_seconds/);
      expect(resource).toMatch(/harness_name\s*=\s*local\.harness_name/);
      expect(resource).toMatch(
        /execution_role_arn\s*=\s*aws_iam_role\.execution_role\.arn/,
      );
      // Values flow only through variables - the resource block never
      // hard-codes the resolved defaults.
      expect(resource).not.toContain(DEFAULT_HARNESS_MODEL_ID);
      expect(resource).not.toContain(DEFAULT_HARNESS_SYSTEM_PROMPT);
      expect(resource).not.toContain('@builtin');
    });

    // Requirement 6.7 semantics (parity with CDK, 13.7): IAM inbound
    // authorization is the provider-native default, represented by omitting
    // custom JWT configuration. The only authorizer_configuration mentions
    // are documentation comments describing the opt-in.
    it('defaults to IAM inbound authorization with no active authorizer_configuration', () => {
      const activeAuthorizerLines = module
        .split('\n')
        .filter(
          (line) =>
            line.includes('authorizer_configuration') &&
            !line.trimStart().startsWith('#'),
        );
      expect(activeAuthorizerLines).toEqual([]);
      // The documented opt-in is custom JWT authorization.
      expect(module).toContain(
        'authorizer_configuration { custom_jwt_authorizer { ... } }',
      );
    });

    // Requirement 7.1: exact service trust with source-account and
    // source-ARN conditions (same normalized semantics as CDK).
    it('trusts bedrock-agentcore.amazonaws.com with SourceAccount and SourceArn conditions', () => {
      const role = tfBlock(module, 'resource "aws_iam_role" "execution_role"');
      expect(role).toContain('Service = "bedrock-agentcore.amazonaws.com"');
      expect(role).toContain('Action = "sts:AssumeRole"');
      expect(role).toMatch(
        /StringEquals = \{\s*"aws:SourceAccount" = local\.account_id\s*\}/,
      );
      expect(role).toMatch(
        /ArnLike = \{\s*"aws:SourceArn" = "arn:\$\{local\.partition\}:bedrock-agentcore:\$\{local\.region\}:\$\{local\.account_id\}:\*"\s*\}/,
      );
    });

    // Requirements 5.6-parity, 7.2-7.4, 13.7: all 12 Baseline Permission
    // statements with exact per-SID actions, resources, and conditions.
    it('renders exactly the 12 baseline permission statements with exact contents', () => {
      const statements = parseBaselineStatements(module);

      // Exactly the 12 design SIDs, in template order.
      expect(Object.keys(statements)).toEqual([...BASELINE_SIDS]);

      expect(statements.BedrockModelInvocation.actions).toEqual([
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
      ]);
      // Model access targets the configurable allowlist local.
      expect(statements.BedrockModelInvocation.resourceRaw).toBe(
        'local.model_resource_arns',
      );

      expect(statements.EcrPublicTokenAccess.actions).toEqual([
        'ecr-public:GetAuthorizationToken',
      ]);
      expect(
        resourceEntries(statements.EcrPublicTokenAccess.resourceRaw),
      ).toEqual(['"*"']);

      expect(statements.StsForEcrPublicPull.actions).toEqual([
        'sts:GetServiceBearerToken',
      ]);
      expect(
        resourceEntries(statements.StsForEcrPublicPull.resourceRaw),
      ).toEqual(['"*"']);

      expect(statements.XRayTracingAccess.actions).toEqual([
        'xray:PutTraceSegments',
        'xray:PutTelemetryRecords',
        'xray:GetSamplingRules',
        'xray:GetSamplingTargets',
      ]);
      expect(resourceEntries(statements.XRayTracingAccess.resourceRaw)).toEqual(
        ['"*"'],
      );

      expect(statements.CloudWatchLogsGroup.actions).toEqual([
        'logs:CreateLogGroup',
        'logs:DescribeLogStreams',
      ]);
      expect(
        resourceEntries(statements.CloudWatchLogsGroup.resourceRaw),
      ).toEqual([
        '"arn:${local.partition}:logs:${local.region}:${local.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*"',
      ]);

      expect(statements.CloudWatchLogsDescribeGroups.actions).toEqual([
        'logs:DescribeLogGroups',
      ]);
      expect(
        resourceEntries(statements.CloudWatchLogsDescribeGroups.resourceRaw),
      ).toEqual([
        '"arn:${local.partition}:logs:${local.region}:${local.account_id}:log-group:*"',
      ]);

      expect(statements.CloudWatchLogsStream.actions).toEqual([
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ]);
      expect(
        resourceEntries(statements.CloudWatchLogsStream.resourceRaw),
      ).toEqual([
        '"arn:${local.partition}:logs:${local.region}:${local.account_id}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*"',
      ]);

      expect(statements.CloudWatchMetricsPublish.actions).toEqual([
        'cloudwatch:PutMetricData',
      ]);
      expect(
        resourceEntries(statements.CloudWatchMetricsPublish.resourceRaw),
      ).toEqual(['"*"']);
      expect(statements.CloudWatchMetricsPublish.conditionRaw).toContain(
        '"cloudwatch:namespace" = "bedrock-agentcore"',
      );

      expect(statements.AgentCoreWorkloadIdentity.actions).toEqual([
        'bedrock-agentcore:GetWorkloadAccessToken',
        'bedrock-agentcore:GetWorkloadAccessTokenForJWT',
      ]);
      // Workload identities follow the harness_<deployed-name>-* pattern.
      expect(
        resourceEntries(statements.AgentCoreWorkloadIdentity.resourceRaw),
      ).toEqual([
        '"arn:${local.partition}:bedrock-agentcore:${local.region}:${local.account_id}:workload-identity-directory/default"',
        '"arn:${local.partition}:bedrock-agentcore:${local.region}:${local.account_id}:workload-identity-directory/default/workload-identity/harness_${local.harness_name}-*"',
      ]);

      expect(statements.AgentCoreBrowserDefault.actions).toEqual([
        'bedrock-agentcore:StartBrowserSession',
        'bedrock-agentcore:StopBrowserSession',
        'bedrock-agentcore:GetBrowserSession',
        'bedrock-agentcore:ListBrowserSessions',
        'bedrock-agentcore:UpdateBrowserStream',
        'bedrock-agentcore:ConnectBrowserAutomationStream',
        'bedrock-agentcore:ConnectBrowserLiveViewStream',
      ]);
      // AWS-owned default browsers only.
      expect(
        resourceEntries(statements.AgentCoreBrowserDefault.resourceRaw),
      ).toEqual([
        '"arn:${local.partition}:bedrock-agentcore:${local.region}:aws:browser/*"',
      ]);

      expect(statements.AgentCoreCodeInterpreterDefault.actions).toEqual([
        'bedrock-agentcore:StartCodeInterpreterSession',
        'bedrock-agentcore:StopCodeInterpreterSession',
        'bedrock-agentcore:GetCodeInterpreterSession',
        'bedrock-agentcore:ListCodeInterpreterSessions',
        'bedrock-agentcore:InvokeCodeInterpreter',
      ]);
      // AWS-owned default code interpreters only.
      expect(
        resourceEntries(statements.AgentCoreCodeInterpreterDefault.resourceRaw),
      ).toEqual([
        '"arn:${local.partition}:bedrock-agentcore:${local.region}:aws:code-interpreter/*"',
      ]);

      // Only CloudWatchMetricsPublish carries a Condition.
      for (const sid of BASELINE_SIDS) {
        if (sid !== 'CloudWatchMetricsPublish') {
          expect(
            statements[sid].conditionRaw,
            `${sid} must not have a Condition`,
          ).toBeUndefined();
        }
      }
    });

    // Requirements 7.5, 7.6: no runtime-command permission and no
    // customer-owned optional-resource access in the defaults.
    it('excludes InvokeAgentRuntimeCommand and customer-owned resources from the defaults', () => {
      expect(module).not.toContain('InvokeAgentRuntimeCommand');
      // Customer-owned optional capabilities remain explicit extensions:
      // these resource/action shapes must not appear in generated defaults.
      expect(module).not.toContain('browser-custom');
      expect(module).not.toContain('code-interpreter-custom');
      expect(module).not.toMatch(/:gateway\//);
      // The default managed-memory grant is scoped to the harness_*
      // name-prefixed memory ARN (AgentCoreManagedMemory above); any
      // unscoped or wildcard memory access would be a BYO/customer-owned
      // extension and must not appear in generated defaults.
      expect(module).not.toMatch(/:memory\/(?!harness_\*)/);
      expect(module).not.toContain('secretsmanager:');
      expect(module).not.toContain('ec2:');
      // No wildcard action grants.
      expect(module).not.toMatch(/Action\s*=\s*(\[\s*)?"\*"/);
    });

    // Requirement 6.5: letter-leading, collision-resistant deployed name of
    // at most 40 characters (31-char truncated prefix + "_" + 8-hex suffix).
    it('generates a letter-leading, length-bounded harness name with the random suffix', () => {
      expect(module).toContain(
        'harness_name_prefix = substr(length(regexall("^[A-Za-z]", "MyHarness")) > 0 ? "MyHarness" : "HMyHarness", 0, 31)',
      );
      expect(module).toContain(
        'harness_name        = "${local.harness_name_prefix}_${random_id.unique_suffix.hex}"',
      );

      const randomId = tfBlock(module, 'resource "random_id" "unique_suffix"');
      expect(randomId).toMatch(/byte_length\s*=\s*4/);
      expect(countOccurrences(module, 'resource "random_id"')).toBe(1);
    });

    // Requirement 6.5 (task 4.3): IAM names reuse the truncated prefix so
    // long project names stay within the IAM role-name limits.
    it('reuses the truncated prefix for the IAM role and policy names', () => {
      expect(module).toContain(
        'name = "${local.harness_name_prefix}-HarnessRole-${random_id.unique_suffix.hex}"',
      );
      expect(module).toContain(
        'name = "${local.harness_name_prefix}-HarnessPolicy"',
      );
    });

    // Requirement 6.9: one runtime-configuration entry module registering
    // { <ClassName> = harness ARN } under agentcore.harnesses.
    it('merges the Harness ARN into runtime configuration under agentcore.harnesses', () => {
      const entry = tfBlock(
        module,
        'module "add_harness_arn_to_runtime_config"',
      );
      expect(entry).toContain('source = "../../../core/runtime-config/entry"');
      expect(entry).toMatch(/namespace\s*=\s*"agentcore"/);
      expect(entry).toMatch(/key\s*=\s*"harnesses"/);
      expect(entry).toContain(
        'value     = { "MyHarness" = aws_bedrockagentcore_harness.this.arn }',
      );
      // Exactly one runtime-configuration registration.
      expect(countOccurrences(module, '\nmodule "')).toBe(1);
    });

    // Requirement 6.10: exactly the three outputs with exact references.
    it('outputs the harness id, harness ARN, and execution role ARN', () => {
      expect(tfBlock(module, 'output "harness_id"')).toMatch(
        /value\s*=\s*aws_bedrockagentcore_harness\.this\.harness_id/,
      );
      expect(tfBlock(module, 'output "harness_arn"')).toMatch(
        /value\s*=\s*aws_bedrockagentcore_harness\.this\.arn/,
      );
      expect(tfBlock(module, 'output "execution_role_arn"')).toMatch(
        /value\s*=\s*aws_iam_role\.execution_role\.arn/,
      );
      expect(countOccurrences(module, '\noutput "')).toBe(3);
    });

    // Requirement 3.5: the documented provider-native advanced extension
    // region inside the resource, listing the 6.54.0 extension surfaces.
    it('documents the provider-native advanced extension region', () => {
      const resource = tfBlock(
        module,
        'resource "aws_bedrockagentcore_harness" "this"',
      );
      expect(resource).toContain('Advanced extension region');
      // Alternate model providers, tools, memory, skills, environments,
      // truncation, custom JWT authorization, and tags are documented as
      // direct provider-native edits.
      for (const token of [
        'gemini_model_config',
        'openai_model_config',
        'tool { ... }',
        'memory { agentcore_memory_configuration { ... } }',
        'skill { path = "..." }',
        'environment_variables',
        'environment_artifact',
        'truncation',
        'custom_jwt_authorizer',
        'tags',
      ]) {
        expect(resource).toContain(token);
      }
      // New capabilities are pointed at the least-privilege extension.
      expect(resource).toContain(
        'var.additional_execution_role_policy_statements',
      );
    });

    // Requirement 4.4: a Terraform run creates no CDK files at all.
    it('creates no files under packages/common/constructs', () => {
      const cdkPaths = tree
        .listChanges()
        .map((change) => change.path)
        .filter((path) => path.startsWith('packages/common/constructs'));
      expect(cdkPaths).toEqual([]);
    });
  });

  describe('custom options', () => {
    // Requirements 3.1, 3.2, 6.7: supplied creation values become the
    // variable defaults; custom limits render as numbers.
    it('renders supplied custom values and limits as variable defaults', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'terraform',
        modelId: 'custom.model-id',
        systemPrompt: 'Custom harness prompt.',
        allowedTools: ['tool-one', 'tool-two'],
        maxIterations: 7,
        maxTokens: 2048,
        timeoutSeconds: 120,
      });
      const module = tree.read(TF_MODULE_PATH, 'utf-8')!;

      expect(tfVariableDefault(module, 'model_id')).toBe('"custom.model-id"');
      expect(tfVariableDefault(module, 'system_prompt')).toBe(
        '"Custom harness prompt."',
      );
      expect(tfVariableDefault(module, 'allowed_tools')).toBe(
        '["tool-one", "tool-two"]',
      );
      expect(tfVariableDefault(module, 'max_iterations')).toBe('7');
      expect(tfVariableDefault(module, 'max_tokens')).toBe('2048');
      expect(tfVariableDefault(module, 'timeout_seconds')).toBe('120');
    });

    // Requirements 3.2, 3.3: each limit is independent - a supplied limit
    // renders as its number while omitted limits stay null.
    it('renders only the supplied limit as a number and keeps the others null', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'terraform',
        maxTokens: 4096,
      });
      const module = tree.read(TF_MODULE_PATH, 'utf-8')!;

      expect(tfVariableDefault(module, 'max_tokens')).toBe('4096');
      expect(tfVariableDefault(module, 'max_iterations')).toBe('null');
      expect(tfVariableDefault(module, 'timeout_seconds')).toBe('null');
    });
  });

  describe('name edge cases', () => {
    const LONG_NAME =
      'very-long-agentcore-harness-name-that-comfortably-exceeds-the-forty-character-harness-name-limit';
    const LONG_CLASS_NAME =
      'VeryLongAgentcoreHarnessNameThatComfortablyExceedsTheFortyCharacterHarnessNameLimit';

    // Requirement 6.5: the deployed-name truncation logic is rendered for
    // names far beyond the 40-character service limit, and the runtime
    // configuration entry still uses the full class name.
    it('renders a well-formed module with truncation logic for a very long name', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: LONG_NAME,
        iac: 'terraform',
      });

      const modulePath = `packages/common/terraform/src/app/harnesses/${LONG_NAME}/${LONG_NAME}.tf`;
      expect(tree.exists(modulePath)).toBe(true);
      const module = tree.read(modulePath, 'utf-8')!;

      // The prefix guard renders the full class name; substr(0, 31) plus
      // the "_" separator and 8-hex suffix bounds the deployed name at 40.
      expect(module).toContain(
        `harness_name_prefix = substr(length(regexall("^[A-Za-z]", "${LONG_CLASS_NAME}")) > 0 ? "${LONG_CLASS_NAME}" : "H${LONG_CLASS_NAME}", 0, 31)`,
      );
      expect(module).toContain(
        'harness_name        = "${local.harness_name_prefix}_${random_id.unique_suffix.hex}"',
      );
      // Runtime configuration keeps the full (untruncated) class name.
      expect(module).toContain(
        `value     = { "${LONG_CLASS_NAME}" = aws_bedrockagentcore_harness.this.arn }`,
      );
    });

    // Requirement 6.5: a digit-leading project name normalizes to a
    // "_"-leading class name, and the rendered guard prepends "H" so the
    // deployed name starts with a letter.
    it('renders the H-prefix fallback for a digit-leading name', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: '1st-harness',
        iac: 'terraform',
      });

      const modulePath =
        'packages/common/terraform/src/app/harnesses/1st-harness/1st-harness.tf';
      expect(tree.exists(modulePath)).toBe(true);
      const module = tree.read(modulePath, 'utf-8')!;

      // toClassName('1st-harness') is '_1stHarness', which fails the
      // letter-leading guard, so the rendered fallback is 'H_1stHarness'.
      expect(module).toContain(
        'harness_name_prefix = substr(length(regexall("^[A-Za-z]", "_1stHarness")) > 0 ? "_1stHarness" : "H_1stHarness", 0, 31)',
      );
      expect(module).toContain(
        'value     = { "_1stHarness" = aws_bedrockagentcore_harness.this.arn }',
      );
    });
  });
});
