/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type MigrationReturnObject,
  type Tree,
  visitNotIgnoredFiles,
} from '@nx/devkit';
import { applyGritQL, matchGritQL } from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';

/**
 * Narrow the agent session storage grants to the actions the session code
 * issues.
 *
 * The CDK constructs granted access with `sessionBucket.grantReadWrite` and
 * `sessionTable.grantReadWriteData`, whose action sets are far wider than the
 * session managers use: object legal-hold/retention/tagging and multipart abort
 * on the bucket, `UpdateItem`/`DeleteItem`/`Scan`/`ConditionCheckItem` and
 * stream reads on the table, plus `kms:Encrypt`/`kms:ReEncrypt*` on the key.
 * Both are replaced with explicit statements, and the Terraform bucket
 * statement is split so the object actions no longer target the bucket ARN
 * itself.
 *
 * These files are generated with `KeepExisting`, so without this an upgraded
 * workspace keeps the wider grants. Diverged files are left untouched and
 * reported via `nextSteps`.
 */

const hcl = (pattern: string) => `language hcl\n${pattern}`;

/** The vended CDK table grant, and the explicit statement replacing it. */
const CDK_TABLE_GRANT = `\`sessionTable.grantReadWriteData(this.agentCoreRuntime);\` => raw\`// Actions the checkpointer issues against the table.
    this.agentCoreRuntime.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:Query',
          'dynamodb:BatchGetItem',
          'dynamodb:BatchWriteItem',
        ],
        resources: [sessionTable.tableArn],
      }),
    );\``;

/** The vended CDK bucket grant, and the explicit statements replacing it. */
const CDK_BUCKET_GRANT = `\`sessionBucket.grantReadWrite(this.agentCoreRuntime);\` => raw\`// Actions the session manager issues against the bucket.
    this.agentCoreRuntime.addToRolePolicy(
      new PolicyStatement({
        actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
        resources: [sessionBucket.arnForObjects('*')],
      }),
    );
    this.agentCoreRuntime.addToRolePolicy(
      new PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [sessionBucket.bucketArn],
      }),
    );
    this.agentCoreRuntime.addToRolePolicy(
      new PolicyStatement({
        actions: ['kms:Decrypt', 'kms:GenerateDataKey*'],
        resources: [sessionKey.keyArn],
      }),
    );\``;

/** `PolicyStatement` is already imported by every agent that grants bedrock. */
const CDK_POLICY_STATEMENT_IMPORT = `\`import { $imports } from 'aws-cdk-lib/aws-iam';\` where { $imports <: contains \`PolicyStatement\` }`;

const CDK_ADD_POLICY_STATEMENT_IMPORT = `\`import { $imports } from 'aws-cdk-lib/aws-iam';\` => \`import { PolicyStatement, $imports } from 'aws-cdk-lib/aws-iam';\``;

/**
 * The Terraform bucket statement, split so the object actions target only
 * `<bucket>/*` and `s3:ListBucket` only the bucket itself.
 */
const TF_BUCKET_STATEMENT = hcl(`\`{
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
    }\` => \`{
      Effect = "Allow"
      Action = [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ]
      Resource = ["\${aws_s3_bucket.session.arn}/*"]
    },
    {
      Effect   = "Allow"
      Action   = ["s3:ListBucket"]
      Resource = [aws_s3_bucket.session.arn]
    }\``);

const cdkDivergedMessage = (filePath: string) =>
  `${filePath}: the session storage IAM grants have diverged from the generated shape - left untouched. Replace \`sessionBucket.grantReadWrite\` / \`sessionTable.grantReadWriteData\` with explicit \`addToRolePolicy\` statements granting only s3:GetObject/PutObject/DeleteObject on \`sessionBucket.arnForObjects('*')\`, s3:ListBucket on the bucket ARN, kms:Decrypt/GenerateDataKey* on the session key, and (for dynamodb-s3) dynamodb:GetItem/PutItem/Query/BatchGetItem/BatchWriteItem on the table ARN.`;

const tfDivergedMessage = (filePath: string) =>
  `${filePath}: the session bucket IAM statement has diverged from the generated shape - left untouched. Split it so s3:GetObject/PutObject/DeleteObject target only "\${aws_s3_bucket.session.arn}/*" and s3:ListBucket targets only aws_s3_bucket.session.arn.`;

/** Narrow the grants in one vended CDK agent construct. */
const migrateCdkAgent = async (
  tree: Tree,
  filePath: string,
  nextSteps: string[],
): Promise<void> => {
  const hasTableGrant = await matchGritQL(
    tree,
    filePath,
    '`sessionTable.grantReadWriteData(this.agentCoreRuntime);`',
  );
  const hasBucketGrant = await matchGritQL(
    tree,
    filePath,
    '`sessionBucket.grantReadWrite(this.agentCoreRuntime);`',
  );

  if (!hasTableGrant && !hasBucketGrant) {
    return;
  }

  // The bucket grant carries the KMS permissions, so an agent with a session
  // table but no recognisable bucket grant is a shape we don't know.
  if (hasTableGrant && !hasBucketGrant) {
    nextSteps.push(cdkDivergedMessage(filePath));
    return;
  }

  if (hasTableGrant) {
    await applyGritQL(tree, filePath, CDK_TABLE_GRANT);
  }
  await applyGritQL(tree, filePath, CDK_BUCKET_GRANT);

  // MCP runtimes don't grant bedrock, so they may not import PolicyStatement.
  if (!(await matchGritQL(tree, filePath, CDK_POLICY_STATEMENT_IMPORT))) {
    await applyGritQL(tree, filePath, CDK_ADD_POLICY_STATEMENT_IMPORT);
  }
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  const cdkFiles: string[] = [];
  const tfFiles: string[] = [];
  visitNotIgnoredFiles(tree, '', (filePath) => {
    if (filePath.endsWith('.ts') && !filePath.endsWith('.d.ts')) {
      cdkFiles.push(filePath);
    } else if (filePath.endsWith('.tf')) {
      tfFiles.push(filePath);
    }
  });

  for (const filePath of cdkFiles) {
    await migrateCdkAgent(tree, filePath, nextSteps);
  }

  for (const filePath of tfFiles) {
    // Only the agent-core app modules define an `aws_s3_bucket.session`.
    if (
      !(await matchGritQL(
        tree,
        filePath,
        hcl('`resource "aws_s3_bucket" "session" { $_ }`'),
      ))
    ) {
      continue;
    }

    // Already split by a previous run.
    if (
      await matchGritQL(tree, filePath, hcl('`Action   = ["s3:ListBucket"]`'))
    ) {
      continue;
    }

    if (!(await applyGritQL(tree, filePath, TF_BUCKET_STATEMENT))) {
      nextSteps.push(tfDivergedMessage(filePath));
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
