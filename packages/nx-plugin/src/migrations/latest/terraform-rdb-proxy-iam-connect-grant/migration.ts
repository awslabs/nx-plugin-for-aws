/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
} from '@nx/devkit';
import { applyGritQL, matchGritQL } from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import {
  PACKAGES_DIR,
  SHARED_TERRAFORM_DIR,
} from '../../../utils/shared-constructs-constants.js';

/**
 * Give the RDS Proxy role in every vended Terraform Aurora app module the
 * `rds-db:connect` grant for the application database user.
 *
 * The proxy is created with `default_auth_scheme = "IAM_AUTH"` and no secrets
 * registered, so `rds-db:connect` on the application user is the only
 * permission it needs to reach the cluster. MySQL modules instead granted the
 * role `secretsmanager:GetSecretValue` on the admin credentials secret plus
 * `kms:Decrypt` — credentials the proxy never uses, and a far wider grant than
 * connecting as the application user.
 *
 * These files are generated with `KeepExisting`, so an upgraded MySQL workspace
 * keeps the admin secret grant until this runs. Diverged files are left
 * untouched and reported via `nextSteps`.
 */

const TERRAFORM_DBS_DIR = `${PACKAGES_DIR}/${SHARED_TERRAFORM_DIR}/src/app/dbs`;

const hcl = (pattern: string) => `language hcl\n${pattern}`;

const CONNECT_STATEMENT_TEXT = [
  '{',
  '        Effect = "Allow"',
  '        Action = ["rds-db:connect"]',
  '        Resource = [',
  '          "arn:aws:rds-db:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:dbuser:${module.aurora.cluster_resource_id}/${local.database_runtime_user}"',
  '        ]',
  '      }',
].join('\n');

const divergedMessage = (filePath: string) =>
  `${filePath}: the aws_iam_role_policy.proxy_db_user_connect policy has diverged from the generated shape - left untouched. The RDS Proxy authenticates to the cluster with IAM, so replace any secretsmanager:GetSecretValue / kms:Decrypt statements on the proxy role with a single rds-db:connect statement for local.database_runtime_user (see the ts#rdb generator's database app template).`;

const proxyPolicyBlock = (body: string) =>
  hcl(`\`resource "aws_iam_role_policy" "proxy_db_user_connect" { ${body} }\``);

const migrateModule = async (
  tree: Tree,
  filePath: string,
  nextSteps: string[],
): Promise<void> => {
  if (!(await matchGritQL(tree, filePath, proxyPolicyBlock('$_')))) {
    return; // No proxy policy in this module - nothing this migration owns.
  }

  if (
    await matchGritQL(
      tree,
      filePath,
      proxyPolicyBlock('$props') +
        ' where { $props <: contains `"rds-db:connect"` }',
    )
  ) {
    return; // Already granted.
  }

  // The whole statement list is replaced, so the policy must still hold exactly
  // the two statements the generator vended and nothing the user has added.
  const secretStatements = hcl(
    [
      '`Statement = [',
      '      {',
      '        Effect = "Allow"',
      '        Action = [',
      '          "secretsmanager:GetSecretValue"',
      '        ]',
      '        Resource = [module.aurora.secret_arn]',
      '      },',
      '      {',
      '        Effect = "Allow"',
      '        Action = [',
      '          "kms:Decrypt"',
      '        ]',
      '        Resource = [module.aurora.kms_key_arn]',
      '      }',
      '    ]`',
    ].join('\n'),
  );

  if (!(await matchGritQL(tree, filePath, secretStatements))) {
    nextSteps.push(divergedMessage(filePath));
    return;
  }

  await applyGritQL(
    tree,
    filePath,
    `${secretStatements} => \`Statement = [\n      ${CONNECT_STATEMENT_TEXT}\n    ]\``,
  );
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  if (!tree.exists(TERRAFORM_DBS_DIR)) {
    return { nextSteps }; // This workspace has no Terraform database modules.
  }

  for (const dirName of tree.children(TERRAFORM_DBS_DIR)) {
    const filePath = joinPathFragments(
      TERRAFORM_DBS_DIR,
      dirName,
      `${dirName}.tf`,
    );
    if (!tree.exists(filePath)) {
      continue; // Not a database app module directory.
    }

    await migrateModule(tree, filePath, nextSteps);
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
