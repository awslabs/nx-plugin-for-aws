/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const CDK_FILE =
  'packages/common/constructs/src/app/harnesses/my-harness/my-harness.ts';
const TF_FILE =
  'packages/common/terraform/src/app/harnesses/my-harness/my-harness.tf';

/** The pre-change shape of the vended CDK Harness construct. */
const CDK_BEFORE = `import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import { Construct } from 'constructs';

export class MyHarness extends Construct {
  public readonly harness: agentcore.CfnHarness;

  constructor(scope: Construct, id: string, props?: MyHarnessProps) {
    super(scope, id);

    const stack = Stack.of(this);
    const {
      executionRole,
      modelResourceArns = [
        \`arn:\${stack.partition}:bedrock:*::foundation-model/*\`,
      ],
      vpc,
      vpcSubnets,
      securityGroups,
      ...harnessProps
    } = props ?? {};

    this.harness = new agentcore.CfnHarness(this, 'Harness', {
      model: {
        bedrockModelConfig: {
          modelId: 'global.anthropic.claude-sonnet-4-6',
        },
      },
      systemPrompt: [{ text: systemPrompt }],
      ...harnessProps,
      // Set after harnessProps so the deployed name always matches the
      // execution role's workload-identity resource pattern.
      harnessName,
      executionRoleArn: this.executionRole.roleArn,
      environment,
    });
  }
}
`;

/** The pre-change shape of the vended Terraform Harness module. */
const TF_BEFORE = `variable "model_id" {
  description = "Amazon Bedrock model or inference profile used by default."
  type        = string
  default     = "global.anthropic.claude-sonnet-4-6"
}

variable "model_resource_arns" {
  description = "Bedrock model and inference-profile ARNs the execution role may invoke."
  type        = set(string)
  default     = null
}

resource "aws_bedrockagentcore_harness" "this" {
  harness_name       = local.harness_name
  execution_role_arn = aws_iam_role.execution_role.arn

  model {
    bedrock_model_config {
      model_id = var.model_id
    }
  }
}
`;

describe('agentcore-harness-no-tools-by-default migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('does nothing in a workspace with no harnesses', async () => {
    const { nextSteps } = await migration(tree);
    expect(nextSteps).toEqual([]);
  });

  describe('cdk', () => {
    beforeEach(() => {
      tree.write(CDK_FILE, CDK_BEFORE);
    });

    it('defaults allowedTools to none and passes it explicitly', async () => {
      const { nextSteps } = await migration(tree);
      expect(nextSteps).toEqual([]);

      const construct = tree.read(CDK_FILE, 'utf-8')!;
      expect(construct).toContain('allowedTools = [],');

      // After the spread, so an undefined caller value cannot reinstate the
      // service's every-tool default.
      const resource = construct.slice(
        construct.indexOf('new agentcore.CfnHarness('),
      );
      expect(resource).toContain('allowedTools,');
      expect(resource.indexOf('...harnessProps,')).toBeLessThan(
        resource.indexOf('allowedTools,'),
      );
      expect(construct).toMatchSnapshot();
    });

    it('is idempotent', async () => {
      await migration(tree);
      const once = tree.read(CDK_FILE, 'utf-8')!;
      await migration(tree);
      expect(tree.read(CDK_FILE, 'utf-8')!).toBe(once);
    });

    it('leaves a harness that already sets tools untouched', async () => {
      const pinned = CDK_BEFORE.replace(
        '      vpc,',
        '      allowedTools = [],\n      vpc,',
      );
      tree.write(CDK_FILE, pinned);

      const { nextSteps } = await migration(tree);
      expect(nextSteps).toEqual([]);
      expect(tree.read(CDK_FILE, 'utf-8')!).toBe(pinned);
    });

    it('reports a diverged construct rather than editing it', async () => {
      tree.write(CDK_FILE, 'export class MyHarness {}\n');

      const { nextSteps } = await migration(tree);
      expect(nextSteps).toHaveLength(1);
      expect(nextSteps[0]).toContain(CDK_FILE);
      expect(nextSteps[0]).toContain('has diverged');
      expect(tree.read(CDK_FILE, 'utf-8')!).toBe('export class MyHarness {}\n');
    });
  });

  describe('terraform', () => {
    beforeEach(() => {
      tree.write(TF_FILE, TF_BEFORE);
    });

    it('declares allowed_tools defaulting to none and assigns it', async () => {
      const { nextSteps } = await migration(tree);
      expect(nextSteps).toEqual([]);

      const tf = tree.read(TF_FILE, 'utf-8')!;
      expect(tf).toMatch(
        /variable "allowed_tools" \{[\s\S]*?type {8}= list\(string\)\n {2}default {5}= \[\]/,
      );
      expect(tf).toContain('allowed_tools      = var.allowed_tools');
      expect(tf).toMatchSnapshot();
    });

    it('is idempotent', async () => {
      await migration(tree);
      const once = tree.read(TF_FILE, 'utf-8')!;
      await migration(tree);
      expect(tree.read(TF_FILE, 'utf-8')!).toBe(once);
    });

    it('leaves a harness that already sets tools untouched', async () => {
      const pinned = TF_BEFORE.replace(
        '  execution_role_arn = aws_iam_role.execution_role.arn',
        '  execution_role_arn = aws_iam_role.execution_role.arn\n  allowed_tools      = ["@builtin"]',
      );
      tree.write(TF_FILE, pinned);

      const { nextSteps } = await migration(tree);
      expect(nextSteps).toEqual([]);
      expect(tree.read(TF_FILE, 'utf-8')!).toBe(pinned);
    });

    it('reports a diverged module rather than editing it', async () => {
      tree.write(TF_FILE, 'locals {}\n');

      const { nextSteps } = await migration(tree);
      expect(nextSteps).toHaveLength(1);
      expect(nextSteps[0]).toContain(TF_FILE);
      expect(nextSteps[0]).toContain('has diverged');
      expect(tree.read(TF_FILE, 'utf-8')!).toBe('locals {}\n');
    });
  });
});
