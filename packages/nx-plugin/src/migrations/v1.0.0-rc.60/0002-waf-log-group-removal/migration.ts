/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { MigrationReturnObject, Tree } from '@nx/devkit';
import {
  addDestructuredImport,
  insertViaGritQL,
  matchGritQL,
} from '../../../utils/ast';
import { formatFilesInSubtree } from '../../../utils/format';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../../utils/shared-constructs-constants';

/**
 * Vended WAF log groups have a deterministic name (WAFv2 requires the
 * `aws-waf-logs-` prefix, so the name can't be CloudFormation-generated) and,
 * without an explicit removal policy, inherit CloudFormation's default RETAIN
 * for log groups. A rolled-back or replaced deploy then orphans the log group,
 * so the next deploy fails to create one of the same name. Set
 * `RemovalPolicy.DESTROY` so it is torn down with the stack, matching the
 * vended user-identity (Cognito) construct.
 */

const CONSTRUCTS_SRC = `${PACKAGES_DIR}/${SHARED_CONSTRUCTS_DIR}/src`;

/**
 * A vended construct carrying a WAF log group. They differ in how the log
 * group is constructed and how `cdk` is imported: the gateway namespaces both
 * (`logs.LogGroup`, `cdk.RemovalPolicy`), the rest api destructures both
 * (`LogGroup`, `RemovalPolicy` — the latter added by this migration when
 * absent).
 */
interface WafConstruct {
  file: string;
  /** How `LogGroup` is referenced in this file (`LogGroup` or `logs.LogGroup`). */
  logGroupExpr: string;
  /** The removal policy expression, matching the file's import style. */
  removalPolicyExpr: string;
  /** When set, ensure this destructured import from `aws-cdk-lib`. */
  destructuredImport?: string;
}

const WAF_CONSTRUCTS: WafConstruct[] = [
  {
    file: `${CONSTRUCTS_SRC}/core/agentcore-gateway/agentcore-gateway.ts`,
    logGroupExpr: 'logs.LogGroup',
    removalPolicyExpr: 'cdk.RemovalPolicy.DESTROY',
  },
  {
    file: `${CONSTRUCTS_SRC}/core/api/rest-api.ts`,
    logGroupExpr: 'LogGroup',
    removalPolicyExpr: 'RemovalPolicy.DESTROY',
    destructuredImport: 'RemovalPolicy',
  },
];

const migrateConstruct = async (
  tree: Tree,
  construct: WafConstruct,
  nextSteps: string[],
): Promise<void> => {
  const { file, logGroupExpr } = construct;
  if (!tree.exists(file)) {
    // Construct not vended in this workspace - nothing to migrate.
    return;
  }

  const contents = tree.read(file, 'utf-8') ?? '';

  // The WAF web ACL (and its log group) is optional in some constructs, so it
  // may be absent. Nothing to do if it is.
  if (!contents.includes(`new ${logGroupExpr}(this, 'WebAclLogs'`)) {
    return;
  }

  // Already migrated (or user-added a removal policy).
  if (
    await matchGritQL(
      tree,
      file,
      `\`new ${logGroupExpr}(this, 'WebAclLogs', { $props })\` where { $props <: contains \`removalPolicy\` }`,
    )
  ) {
    return;
  }

  // Append the removal policy after the WAF log group's `encryptionKey`
  // property. The rewrite is scoped to the `WebAclLogs` LogGroup because a
  // construct can have other log groups sharing the `encryptionKey: logsKey`
  // shape (e.g. the rest api's access logs).
  const added = await insertViaGritQL(
    tree,
    file,
    `\`new ${logGroupExpr}(this, 'WebAclLogs', { $props })\` where {
  $props <: contains \`encryptionKey: logsKey\` as $enc,
  $enc => \`encryptionKey: logsKey,
      __GRIT_INSERT_PLACEHOLDER__\`
}`,
    `// The log group name is deterministic, so retaining it on delete would
      // orphan it and block re-creation (e.g. after a rolled-back deploy).
      removalPolicy: ${construct.removalPolicyExpr}`,
  );

  if (!added) {
    nextSteps.push(
      `${file}: could not add a removal policy to the WAF log group automatically - it may have diverged from the generated shape. Add \`removalPolicy: ${construct.removalPolicyExpr}\` to the \`new ${logGroupExpr}(this, 'WebAclLogs', ...)\` call so a rolled-back deploy does not orphan the log group.`,
    );
    return;
  }

  if (construct.destructuredImport) {
    await addDestructuredImport(
      tree,
      file,
      [construct.destructuredImport],
      'aws-cdk-lib',
    );
  }
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const construct of WAF_CONSTRUCTS) {
    await migrateConstruct(tree, construct, nextSteps);
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
