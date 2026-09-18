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
  GRIT_INSERT_PLACEHOLDER,
  insertViaGritQL,
  matchGritQL,
} from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import {
  PACKAGES_DIR,
  SHARED_TERRAFORM_DIR,
} from '../../../utils/shared-constructs-constants.js';
import { TERRAFORM_VERSIONS } from '../../../utils/versions.js';

/**
 * Wait for the AgentCore Harness execution role to propagate before creating the
 * Harness.
 *
 * IAM is eventually consistent, and CreateHarness validates the execution role by
 * assuming it. Depending on the role's policy alone, the validation can run before
 * the role has propagated and the Harness lands in CREATE_FAILED with "Role
 * validation failed", failing the apply.
 *
 * These files are generated with `KeepExisting`, so an upgraded workspace keeps
 * the older module until this runs. Modules that have diverged from the generated
 * shape are left untouched and reported via `nextSteps`.
 */

const TERRAFORM_HARNESS_APP_DIR = `${PACKAGES_DIR}/${SHARED_TERRAFORM_DIR}/src/app/harnesses`;

const hcl = (pattern: string) => `language hcl\n${pattern}`;

const divergedMessage = (filePath: string) =>
  `${filePath}: has diverged from the generated shape - left untouched. To wait for the execution role to propagate before the Harness is created, compare it against the agentcore-harness generator's Terraform template and add the time_sleep.execution_role_propagation resource the Harness depends on.`;

/**
 * Indented as `terraform fmt` writes a `required_providers` entry, since `.tf`
 * files are not reformatted after a migration and the vended `format` target
 * fails on one that isn't.
 */
const TIME_PROVIDER_TEXT = `    time = {
      source  = "hashicorp/time"
      version = "${TERRAFORM_VERSIONS.time}"
    }`;

const TIME_SLEEP_TEXT = `# IAM is eventually consistent, and CreateHarness validates the execution role
# by assuming it. Without this wait the validation intermittently runs before
# the role and its policy have propagated and the Harness lands in CREATE_FAILED
# with "Role validation failed".
resource "time_sleep" "execution_role_propagation" {
  count = var.create_execution_role ? 1 : 0

  depends_on = [aws_iam_role.execution_role, aws_iam_role_policy.execution_role]

  create_duration = "30s"

  triggers = {
    assume_role_policy = aws_iam_role.execution_role[0].assume_role_policy
    policy             = aws_iam_role_policy.execution_role[0].policy
  }
}`;

/**
 * Every shape the migration rewrites, so a module missing any of them is
 * reported rather than half-migrated. The role and its policy are indexed, which
 * is the shape the earlier `terraform-harness-vpc-role-and-memory-grant`
 * migration leaves behind.
 */
const REQUIRED_SHAPES = [
  '`required_providers { $_ }`',
  '`resource "aws_iam_role" "execution_role" { $_ }`',
  '`resource "aws_iam_role_policy" "execution_role" { $_ }`',
  '`resource "aws_bedrockagentcore_harness" "this" { $_ }`',
  '`count = var.create_execution_role ? 1 : 0`',
  // The dependency this migration re-points, and where the wait is inserted.
  '`depends_on = [aws_iam_role_policy.execution_role]`',
];

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
      await matchGritQL(
        tree,
        filePath,
        hcl('`resource "time_sleep" "execution_role_propagation" { $_ }`'),
      )
    ) {
      continue; // Already migrated.
    }

    const shapeChecks = await Promise.all(
      REQUIRED_SHAPES.map((shape) => matchGritQL(tree, filePath, hcl(shape))),
    );
    if (shapeChecks.includes(false)) {
      nextSteps.push(divergedMessage(filePath));
      continue;
    }

    // `time_sleep` is a resource of the time provider, which the module has not
    // needed until now. Appended after the existing body, so an entry the user
    // has customised is left as it is.
    await insertViaGritQL(
      tree,
      filePath,
      hcl(
        `\`required_providers { $body }\` => \`required_providers {\n    $body\n    ${GRIT_INSERT_PLACEHOLDER}\n  }\`` +
          ' where { $body <: not contains `time = { $_ }` }',
      ),
      // The placeholder already sits at the entry's indentation.
      TIME_PROVIDER_TEXT.replace(/^ {4}/, ''),
    );

    // After the baseline policy, which is what the wait waits for and what the
    // generator writes it after.
    await insertViaGritQL(
      tree,
      filePath,
      hcl(
        `\`resource "aws_iam_role_policy" "execution_role" { $body }\` => \`resource "aws_iam_role_policy" "execution_role" {\n  $body\n}\n\n${GRIT_INSERT_PLACEHOLDER}\``,
      ),
      TIME_SLEEP_TEXT,
    );

    // The Harness waits on the whole chain rather than the policy alone.
    await applyGritQL(
      tree,
      filePath,
      hcl(
        '`depends_on = [aws_iam_role_policy.execution_role]` => `depends_on = [time_sleep.execution_role_propagation]`',
      ),
    );
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
