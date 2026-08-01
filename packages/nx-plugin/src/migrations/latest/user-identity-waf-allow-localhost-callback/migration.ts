/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { MigrationReturnObject, Tree } from '@nx/devkit';
import { applyGritQL, matchGritQL } from '../../../utils/ast';
import { formatFilesInSubtree } from '../../../utils/format';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../../../utils/shared-constructs-constants';

/**
 * Count the EC2MetaDataSSRF_QUERYARGUMENTS WAF rule on the UserIdentity Web ACL
 *
 * `AWSManagedRulesCommonRuleSet` blocks any query argument that looks like an
 * SSRF target, which includes the `redirect_uri=http://localhost:...` the Cognito
 * Hosted UI receives when signing in against a local dev server. Sign-in fails
 * with an opaque 403 before the login page renders. The rule is overridden to
 * Count so local sign-in works; every other rule in the group still blocks.
 *
 * How to write a migration:
 * - https://nx.dev/docs/kb/migration-generators
 * - What `nextSteps` means: https://nx.dev/docs/reference/devkit/MigrationReturnObject
 *
 * Guardrails:
 * - Pattern-match before writing: skip files that have diverged from the shape
 *   your generators produce and report them via `nextSteps`, rather than
 *   clobbering the user's changes.
 * - Idempotent: re-running must be a no-op.
 * - Format what you write: finish with `formatFilesInSubtree` so the files your
 *   migration wrote are formatted correctly.
 */

const CDK_USER_IDENTITY_FILE = `${PACKAGES_DIR}/${SHARED_CONSTRUCTS_DIR}/src/core/user-identity.ts`;
const TERRAFORM_IDENTITY_FILE = `${PACKAGES_DIR}/${SHARED_TERRAFORM_DIR}/src/core/user-identity/identity/identity.tf`;

const SSRF_RULE_NAME = 'EC2MetaDataSSRF_QUERYARGUMENTS';

// Guards each file: present only once the override has been added.
const CDK_MIGRATED_PATTERN = `\`ruleActionOverrides: [{ name: '${SSRF_RULE_NAME}', actionToUse: { count: {} } }]\``;
const TERRAFORM_MIGRATED_PATTERN = `language hcl\n\`name = "${SSRF_RULE_NAME}"\``;

const OVERRIDE_COMMENT_LINES = [
  `// ${SSRF_RULE_NAME} blocks any query argument that looks`,
  '// like an SSRF target, which includes the localhost redirect_uri the',
  '// Hosted UI receives when signing in against a local dev server.',
  '// Counted rather than blocked so local sign-in works; every other rule',
  '// in the group still blocks.',
];

// Matched on the managed rule group statement rather than the whole rule, so
// argument order and formatting elsewhere in the Web ACL don't matter.
const CDK_STATEMENT_PATTERN =
  "`managedRuleGroupStatement: { name: 'AWSManagedRulesCommonRuleSet', vendorName: 'AWS' }`";

const CDK_REWRITE = `${CDK_STATEMENT_PATTERN} => \`managedRuleGroupStatement: {
              name: 'AWSManagedRulesCommonRuleSet',
              vendorName: 'AWS',
              ${OVERRIDE_COMMENT_LINES.join('\n              ')}
              ruleActionOverrides: [
                {
                  name: '${SSRF_RULE_NAME}',
                  actionToUse: { count: {} },
                },
              ],
            }\``;

const TERRAFORM_REWRITE = [
  'language hcl',
  '`managed_rule_group_statement {',
  '        name        = "AWSManagedRulesCommonRuleSet"',
  '        vendor_name = "AWS"',
  '      }` => `managed_rule_group_statement {',
  '        name        = "AWSManagedRulesCommonRuleSet"',
  '        vendor_name = "AWS"',
  '',
  `        # ${SSRF_RULE_NAME} blocks any query argument that looks like`,
  '        # an SSRF target, which includes the localhost redirect_uri the Hosted UI',
  '        # receives when signing in against a local dev server. Counted rather than',
  '        # blocked so local sign-in works; every other rule in the group still blocks.',
  '        rule_action_override {',
  `          name = "${SSRF_RULE_NAME}"`,
  '',
  '          action_to_use {',
  '            count {}',
  '          }',
  '        }',
  '      }`',
].join('\n');

const divergedNextStep = (filePath: string) =>
  `${filePath}: the UserIdentity Web ACL has diverged from the generated shape - left untouched. To sign in against a local dev server, override ${SSRF_RULE_NAME} in the AWSManagedRulesCommonRuleSet rule group to Count, otherwise the Cognito Hosted UI returns 403 for localhost redirect URIs.`;

const migratedNextStep = (filePath: string) =>
  `${filePath}: ${SSRF_RULE_NAME} is now counted rather than blocked, so signing in against a local dev server works. Redeploy to apply it.`;

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const [filePath, migratedPattern, rewrite] of [
    [CDK_USER_IDENTITY_FILE, CDK_MIGRATED_PATTERN, CDK_REWRITE],
    [TERRAFORM_IDENTITY_FILE, TERRAFORM_MIGRATED_PATTERN, TERRAFORM_REWRITE],
  ] as const) {
    if (!tree.exists(filePath)) {
      // This workspace doesn't use this IaC provider, or has no UserIdentity.
      continue;
    }

    if (await matchGritQL(tree, filePath, migratedPattern)) {
      // Already migrated - silent skip keeps re-runs a no-op.
      continue;
    }

    if (await applyGritQL(tree, filePath, rewrite)) {
      nextSteps.push(migratedNextStep(filePath));
    } else {
      nextSteps.push(divergedNextStep(filePath));
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
