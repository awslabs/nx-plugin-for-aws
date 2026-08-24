/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { MigrationReturnObject, Tree } from '@nx/devkit';
import { applyGritQL, matchGritQL } from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../../../utils/shared-constructs-constants.js';

/**
 * Count the EC2MetaDataSSRF_QUERYARGUMENTS WAF rule on the UserIdentity Web ACL
 *
 * `AWSManagedRulesCommonRuleSet` treats the loopback `redirect_uri` the Cognito
 * Hosted UI receives during local sign-in as an SSRF attempt, so sign-in against
 * a local dev server fails with an opaque 403 before the login page renders. The
 * rule is overridden to Count while a local callback URL is allowed; every other
 * rule in the group still blocks.
 *
 * The local callback URLs are lifted into a named constant so the override can be
 * derived from them rather than restating the condition.
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
const CDK_MIGRATED_PATTERN = `\`ruleActionOverrides: allowsLocalCallback ? $_ : undefined\``;
const TERRAFORM_MIGRATED_PATTERN = `language hcl\n\`name = "${SSRF_RULE_NAME}"\``;

// Every CDK edit site, matched structurally so formatting doesn't affect whether
// the construct is recognised.
const CDK_CONSTANT_ANCHOR_PATTERN = "`const WEB_CLIENT_ID = 'WebClient'`";
// Scoped to the `.concat` callsite so it can't also rewrite the array literal
// inside the constant this migration inserts.
const CDK_LOCAL_URLS_PATTERN =
  "`['http://localhost:4200', 'http://localhost:4300'].concat($rest)`";
const CDK_CALL_PATTERN = '`this.createWebAcl($id, this.userPool)`';
const CDK_SIGNATURE_PATTERN =
  '`private createWebAcl = ($id: string, $pool: UserPool) => $body`';
const CDK_STATEMENT_PATTERN =
  "`managedRuleGroupStatement: { name: 'AWSManagedRulesCommonRuleSet', vendorName: 'AWS' }`";

const CDK_EDITS: Array<[string, string]> = [
  // Local callback URLs become a named constant the override can key off.
  [
    CDK_CONSTANT_ANCHOR_PATTERN,
    `${CDK_CONSTANT_ANCHOR_PATTERN} => \`const WEB_CLIENT_ID = 'WebClient';

/** Local dev server origins permitted to complete the sign-in redirect */
const LOCAL_CALLBACK_URLS = ['http://localhost:4200', 'http://localhost:4300']\``,
  ],
  [
    CDK_LOCAL_URLS_PATTERN,
    `${CDK_LOCAL_URLS_PATTERN} => \`LOCAL_CALLBACK_URLS.concat($rest)\``,
  ],
  [
    CDK_CALL_PATTERN,
    `${CDK_CALL_PATTERN} => \`this.createWebAcl($id, this.userPool, LOCAL_CALLBACK_URLS.length > 0)\``,
  ],
  [
    CDK_SIGNATURE_PATTERN,
    `${CDK_SIGNATURE_PATTERN} => \`private createWebAcl = (
    $id: string,
    $pool: UserPool,
    allowsLocalCallback: boolean
  ) => $body\``,
  ],
  [
    CDK_STATEMENT_PATTERN,
    `${CDK_STATEMENT_PATTERN} => \`managedRuleGroupStatement: {
              name: 'AWSManagedRulesCommonRuleSet',
              vendorName: 'AWS',
              // ${SSRF_RULE_NAME} treats the loopback redirect_uri the
              // Hosted UI receives during local sign-in as an SSRF attempt. Counted
              // only while a local callback URL is allowed; every other rule blocks.
              ruleActionOverrides: allowsLocalCallback
                ? [
                    {
                      name: '${SSRF_RULE_NAME}',
                      actionToUse: { count: {} },
                    },
                  ]
                : undefined,
            }\``,
  ],
];

const TERRAFORM_DATA_SOURCES_PATTERN = [
  'language hcl',
  '`data "aws_region" "current" {}`',
].join('\n');

const TERRAFORM_EDITS: Array<[string, string]> = [
  // Local callback URLs become a local the override can key off.
  [
    TERRAFORM_DATA_SOURCES_PATTERN,
    [
      'language hcl',
      '`data "aws_region" "current" {}` => `data "aws_region" "current" {}',
      '',
      'locals {',
      '  # Local dev server origins permitted to complete the sign-in redirect',
      '  local_callback_urls = [',
      '    "http://localhost:4200",',
      '    "http://localhost:4300"',
      '  ]',
      '}`',
    ].join('\n'),
  ],
  [
    [
      'language hcl',
      '`callback_urls = concat([',
      '    "http://localhost:4200",',
      '    "http://localhost:4300"',
      '  ], var.callback_urls)`',
    ].join('\n'),
    [
      'language hcl',
      '`callback_urls = concat([',
      '    "http://localhost:4200",',
      '    "http://localhost:4300"',
      '  ], var.callback_urls)` => `callback_urls = concat(local.local_callback_urls, var.callback_urls)`',
    ].join('\n'),
  ],
  [
    [
      'language hcl',
      '`logout_urls = concat([',
      '    "http://localhost:4200",',
      '    "http://localhost:4300"',
      '  ], var.logout_urls)`',
    ].join('\n'),
    [
      'language hcl',
      '`logout_urls = concat([',
      '    "http://localhost:4200",',
      '    "http://localhost:4300"',
      '  ], var.logout_urls)` => `logout_urls = concat(local.local_callback_urls, var.logout_urls)`',
    ].join('\n'),
  ],
  [
    [
      'language hcl',
      '`managed_rule_group_statement {',
      '        name        = "AWSManagedRulesCommonRuleSet"',
      '        vendor_name = "AWS"',
      '      }`',
    ].join('\n'),
    [
      'language hcl',
      '`managed_rule_group_statement {',
      '        name        = "AWSManagedRulesCommonRuleSet"',
      '        vendor_name = "AWS"',
      '      }` => `managed_rule_group_statement {',
      '        name        = "AWSManagedRulesCommonRuleSet"',
      '        vendor_name = "AWS"',
      '',
      `        # ${SSRF_RULE_NAME} treats the loopback redirect_uri the`,
      '        # Hosted UI receives during local sign-in as an SSRF attempt. Counted',
      '        # only while a local callback URL is allowed; every other rule blocks.',
      '        dynamic "rule_action_override" {',
      '          for_each = length(local.local_callback_urls) > 0 ? [1] : []',
      '',
      '          content {',
      `            name = "${SSRF_RULE_NAME}"`,
      '',
      '            action_to_use {',
      '              count {}',
      '            }',
      '          }',
      '        }',
      '      }`',
    ].join('\n'),
  ],
];

const divergedNextStep = (filePath: string) =>
  `${filePath}: the UserIdentity Web ACL has diverged from the generated shape - left untouched. To sign in against a local dev server, override ${SSRF_RULE_NAME} in the AWSManagedRulesCommonRuleSet rule group to Count, otherwise the Cognito Hosted UI returns 403 for localhost redirect URIs.`;

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const [filePath, migratedPattern, edits] of [
    [CDK_USER_IDENTITY_FILE, CDK_MIGRATED_PATTERN, CDK_EDITS],
    [TERRAFORM_IDENTITY_FILE, TERRAFORM_MIGRATED_PATTERN, TERRAFORM_EDITS],
  ] as const) {
    if (!tree.exists(filePath)) {
      // This workspace doesn't use this IaC provider, or has no UserIdentity.
      continue;
    }

    if (await matchGritQL(tree, filePath, migratedPattern)) {
      // Already migrated - silent skip keeps re-runs a no-op.
      continue;
    }

    // Confirm every edit site is present before writing any of them, so a file
    // that only partly matches is left whole rather than half-edited.
    const allSitesPresent = (
      await Promise.all(
        edits.map(([match]) => matchGritQL(tree, filePath, match)),
      )
    ).every(Boolean);

    if (!allSitesPresent) {
      nextSteps.push(divergedNextStep(filePath));
      continue;
    }

    for (const [, rewrite] of edits) {
      await applyGritQL(tree, filePath, rewrite);
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
