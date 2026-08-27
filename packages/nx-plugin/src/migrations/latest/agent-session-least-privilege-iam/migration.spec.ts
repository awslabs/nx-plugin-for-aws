/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const CDK_FILE =
  'packages/common/constructs/src/app/agents/my-agent/my-agent.ts';
const TF_FILE = 'packages/common/terraform/src/app/agents/my-agent/my-agent.tf';

/** The pre-change CDK shape: coarse grant helpers for both stores. */
const cdkBefore = (session: 's3' | 'dynamodb-s3') => `import {
  PolicyStatement,
  Effect,
  ServicePrincipal,
  IGrantable,
  IPrincipal,
} from 'aws-cdk-lib/aws-iam';

export class MyAgent extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const sessionKey = new Key(this, 'SessionKey', { enableKeyRotation: true });
    const sessionBucket = new Bucket(this, 'SessionBucket', {});
${
  session === 'dynamodb-s3'
    ? `    const sessionTable = new Table(this, 'SessionTable', {});\n`
    : ''
}
${session === 'dynamodb-s3' ? '    sessionTable.grantReadWriteData(this.agentCoreRuntime);\n' : ''}    sessionBucket.grantReadWrite(this.agentCoreRuntime);

    rc.grantReadAppConfig(this.agentCoreRuntime);
  }
}
`;

/** The pre-change Terraform shape: one statement covering bucket and objects. */
const TF_BEFORE = `resource "aws_s3_bucket" "session" {
  bucket = "my-agent-sessions"
}

module "agent_core_runtime" {
  source = "../../../core/agent-core"

  additional_iam_policy_statements = concat([
    {
      Effect = "Allow"
      Action = [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ]
      Resource = [
        aws_s3_bucket.session.arn,
        "\${aws_s3_bucket.session.arn}/*"
      ]
    },
    {
      Effect = "Allow"
      Action = [
        "kms:Decrypt",
        "kms:GenerateDataKey*"
      ]
      Resource = [aws_kms_key.session.arn]
    }
  ], var.additional_iam_policy_statements)
}
`;

describe('agent-session-least-privilege-iam migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should replace the CDK bucket grant with explicit statements', async () => {
    tree.write(CDK_FILE, cdkBefore('s3'));

    const result = await migration(tree);
    const content = tree.read(CDK_FILE, 'utf-8')!;

    expect(content).not.toContain('sessionBucket.grantReadWrite');
    expect(content).toContain(
      "'s3:GetObject', 's3:PutObject', 's3:DeleteObject'",
    );
    expect(content).toContain("sessionBucket.arnForObjects('*')");
    expect(content).toContain("actions: ['s3:ListBucket']");
    expect(content).toContain('resources: [sessionBucket.bucketArn]');
    expect(content).toContain("'kms:Decrypt', 'kms:GenerateDataKey*'");
    expect(content).toContain('resources: [sessionKey.keyArn]');

    // The wide actions the grant helper used to add must be gone.
    expect(content).not.toContain('s3:Abort');
    expect(content).not.toContain('kms:Encrypt');

    expect(result.nextSteps).toEqual([]);
  });

  it('should replace the CDK table grant with explicit statements', async () => {
    tree.write(CDK_FILE, cdkBefore('dynamodb-s3'));

    const result = await migration(tree);
    const content = tree.read(CDK_FILE, 'utf-8')!;

    expect(content).not.toContain('sessionTable.grantReadWriteData');
    expect(content).toContain("'dynamodb:GetItem'");
    expect(content).toContain("'dynamodb:BatchWriteItem'");
    expect(content).toContain('resources: [sessionTable.tableArn]');

    // Actions the checkpointer never issues must not be granted.
    for (const action of [
      'dynamodb:UpdateItem',
      'dynamodb:DeleteItem',
      'dynamodb:Scan',
      'dynamodb:ConditionCheckItem',
      'dynamodb:DescribeTable',
    ]) {
      expect(content).not.toContain(action);
    }

    expect(result.nextSteps).toEqual([]);
  });

  it('should add the PolicyStatement import when absent', async () => {
    tree.write(CDK_FILE, cdkBefore('s3').replace('  PolicyStatement,\n', ''));

    await migration(tree);
    const content = tree.read(CDK_FILE, 'utf-8')!;

    expect(content).toContain('PolicyStatement');
    expect(
      content.match(/PolicyStatement,/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(1);
    // Only one aws-iam import statement.
    expect(content.match(/from 'aws-cdk-lib\/aws-iam'/g)).toHaveLength(1);
  });

  it('should split the Terraform bucket statement by resource', async () => {
    tree.write(TF_FILE, TF_BEFORE);

    const result = await migration(tree);
    const content = tree.read(TF_FILE, 'utf-8')!;

    expect(content).toContain('Resource = ["${aws_s3_bucket.session.arn}/*"]');
    expect(content).toContain('Action   = ["s3:ListBucket"]');
    expect(content).toContain('Resource = [aws_s3_bucket.session.arn]');
    expect(result.nextSteps).toEqual([]);
  });

  it('should leave a diverged CDK file untouched and report it', async () => {
    const diverged = cdkBefore('dynamodb-s3').replace(
      '    sessionBucket.grantReadWrite(this.agentCoreRuntime);\n',
      '    sessionBucket.grantReadWrite(someOtherPrincipal);\n',
    );
    tree.write(CDK_FILE, diverged);

    const result = await migration(tree);

    expect(tree.read(CDK_FILE, 'utf-8')).toEqual(diverged);
    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps?.[0]).toContain(CDK_FILE);
  });

  it('should leave a diverged Terraform statement untouched and report it', async () => {
    const diverged = TF_BEFORE.replace('"s3:DeleteObject",\n        ', '');
    tree.write(TF_FILE, diverged);

    const result = await migration(tree);

    expect(tree.read(TF_FILE, 'utf-8')).toEqual(diverged);
    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps?.[0]).toContain(TF_FILE);
  });

  it('should ignore files without session storage', async () => {
    const unrelated = `resource "aws_s3_bucket" "website" {
  bucket = "my-website"
}
`;
    tree.write(
      'packages/common/terraform/src/app/website/website.tf',
      unrelated,
    );

    const result = await migration(tree);

    expect(
      tree.read(
        'packages/common/terraform/src/app/website/website.tf',
        'utf-8',
      ),
    ).toEqual(unrelated);
    expect(result.nextSteps).toEqual([]);
  });

  it('should be idempotent', async () => {
    tree.write(CDK_FILE, cdkBefore('dynamodb-s3'));
    tree.write(TF_FILE, TF_BEFORE);

    const first = await migration(tree);
    const cdkAfterFirst = tree.read(CDK_FILE, 'utf-8')!;
    const tfAfterFirst = tree.read(TF_FILE, 'utf-8')!;

    const second = await migration(tree);

    expect(tree.read(CDK_FILE, 'utf-8')).toEqual(cdkAfterFirst);
    expect(tree.read(TF_FILE, 'utf-8')).toEqual(tfAfterFirst);
    expect(second.nextSteps).toEqual(first.nextSteps);
    expect(second.nextSteps).toEqual([]);
  });
});
