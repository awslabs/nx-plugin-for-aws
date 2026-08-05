/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { MigrationReturnObject, Tree } from '@nx/devkit';
import { insertViaGritQL, matchGritQL } from '../../../utils/ast';
import { formatFilesInSubtree } from '../../../utils/format';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../../utils/shared-constructs-constants';

/**
 * The WAF log group in the vended `AgentCoreGateway` construct has a
 * deterministic name and, without an explicit removal policy, inherits
 * CloudFormation's default RETAIN for log groups. A rolled-back deploy then
 * orphans it, so the next deploy fails to create a log group of the same name.
 * Set `RemovalPolicy.DESTROY` so it is torn down with the stack.
 */

const GATEWAY_CONSTRUCT_FILE = `${PACKAGES_DIR}/${SHARED_CONSTRUCTS_DIR}/src/core/agentcore-gateway/agentcore-gateway.ts`;

const REMOVAL_POLICY = `// The log group name is deterministic, so retaining it on delete would
      // orphan it and block re-creation (e.g. after a rolled-back deploy).
      removalPolicy: cdk.RemovalPolicy.DESTROY`;

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  if (!tree.exists(GATEWAY_CONSTRUCT_FILE)) {
    // No vended gateway construct in this workspace - nothing to migrate.
    return { nextSteps };
  }

  const contents = tree.read(GATEWAY_CONSTRUCT_FILE, 'utf-8') ?? '';

  // Only mcp gateways carry a WAF web ACL; an http-only workspace's construct
  // may lack the log group entirely. Nothing to do if it's absent.
  if (!contents.includes("new logs.LogGroup(this, 'WebAclLogs'")) {
    return { nextSteps };
  }

  // Already migrated (or user-added a removal policy).
  if (
    await matchGritQL(
      tree,
      GATEWAY_CONSTRUCT_FILE,
      "`new logs.LogGroup(this, 'WebAclLogs', { $props })` where { $props <: contains `removalPolicy` }",
    )
  ) {
    return { nextSteps };
  }

  // `encryptionKey: logsKey` is the WAF log group's last property and appears
  // once in the construct, so append the removal policy after it.
  const added = await insertViaGritQL(
    tree,
    GATEWAY_CONSTRUCT_FILE,
    `\`encryptionKey: logsKey\` => \`encryptionKey: logsKey,
      __GRIT_INSERT_PLACEHOLDER__\``,
    REMOVAL_POLICY,
  );

  if (!added) {
    nextSteps.push(
      `${GATEWAY_CONSTRUCT_FILE}: could not add a removal policy to the WAF log group automatically - it may have diverged from the generated shape. Add \`removalPolicy: cdk.RemovalPolicy.DESTROY\` to the \`new logs.LogGroup(this, 'WebAclLogs', ...)\` call so a rolled-back deploy does not orphan the log group.`,
    );
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
