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
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../../../utils/shared-constructs-constants.js';

/**
 * Pin each vended Harness to no tools by default.
 *
 * AgentCore treats an absent `allowedTools` as every tool, so a Harness that
 * never set it deployed with `allowedTools: ["*"]` — shell execution and file
 * read/write included. Both providers now send the field explicitly, defaulting
 * to none.
 *
 * These files are generated with `KeepExisting`, so an upgraded workspace keeps
 * the implicit every-tool default until this runs. Diverged files are left
 * untouched and reported via `nextSteps`.
 */

const CDK_HARNESSES_DIR = `${PACKAGES_DIR}/${SHARED_CONSTRUCTS_DIR}/src/app/harnesses`;
const TERRAFORM_HARNESSES_DIR = `${PACKAGES_DIR}/${SHARED_TERRAFORM_DIR}/src/app/harnesses`;

const hcl = (pattern: string) => `language hcl\n${pattern}`;

const ALLOWED_TOOLS_VARIABLE = [
  'variable "allowed_tools" {',
  '  description = "Tools the Harness may use. Defaults to none; set [\\"@builtin\\"] for every built-in tool, or name individual tools. Always sent explicitly, since the service treats an absent value as every tool."',
  '  type        = list(string)',
  '  default     = []',
  '}',
].join('\n');

const divergedMessage = (filePath: string, remedy: string) =>
  `${filePath}: has diverged from the generated shape - left untouched. AgentCore treats an absent allowedTools as every tool, so this Harness deploys with all built-in tools (including shell and file access). ${remedy}`;

/**
 * Default the construct's `allowedTools` to none and pass it to the resource
 * after the props spread, so an undefined caller value cannot reinstate the
 * service's every-tool default.
 */
const migrateCdkConstruct = async (
  tree: Tree,
  filePath: string,
): Promise<boolean> => {
  const destructured = await insertViaGritQL(
    tree,
    filePath,
    `\`const { $fields } = props ?? {};\` => \`const {\n      ${GRIT_INSERT_PLACEHOLDER}\n      $fields\n    } = props ?? {};\``,
    [
      '// The service treats an absent allowedTools as every tool, so this',
      '// defaults to none and is always passed explicitly.',
      'allowedTools = [],',
    ].join('\n      '),
  );
  if (!destructured) return false;

  return await applyGritQL(
    tree,
    filePath,
    '`new agentcore.CfnHarness($scope, $id, { $props })` where {' +
      ' $props <: contains spread_element() as $spread,' +
      ' $spread => `$spread,\n      allowedTools`' +
      ' }',
  );
};

/**
 * Declare `allowed_tools` and assign it to the Harness resource, so the module
 * always sends the field.
 */
const migrateTerraformModule = async (
  tree: Tree,
  filePath: string,
): Promise<boolean> => {
  const declared = await insertViaGritQL(
    tree,
    filePath,
    hcl(
      `\`variable "model_resource_arns" { $props }\` => \`${GRIT_INSERT_PLACEHOLDER}\n\nvariable "model_resource_arns" {\n  $props\n}\``,
    ),
    ALLOWED_TOOLS_VARIABLE,
  );
  if (!declared) return false;

  // Appended after the existing arguments so their alignment is preserved;
  // `terraform fmt` re-aligns the block.
  return await applyGritQL(
    tree,
    filePath,
    hcl(
      '`execution_role_arn = aws_iam_role.execution_role.arn` => `execution_role_arn = aws_iam_role.execution_role.arn\n  allowed_tools      = var.allowed_tools`',
    ),
  );
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const dirName of tree.exists(CDK_HARNESSES_DIR)
    ? tree.children(CDK_HARNESSES_DIR)
    : []) {
    const filePath = joinPathFragments(
      CDK_HARNESSES_DIR,
      dirName,
      `${dirName}.ts`,
    );
    if (!tree.exists(filePath)) {
      continue; // Not a Harness construct directory.
    }

    // Already pinned, by this migration or by hand.
    if (tree.read(filePath, 'utf-8')?.includes('allowedTools = [],')) {
      continue;
    }

    if (!(await migrateCdkConstruct(tree, filePath))) {
      nextSteps.push(
        divergedMessage(
          filePath,
          'Default `allowedTools` to `[]` when destructuring props, and pass `allowedTools` to the CfnHarness after the `...harnessProps` spread.',
        ),
      );
    }
  }

  for (const dirName of tree.exists(TERRAFORM_HARNESSES_DIR)
    ? tree.children(TERRAFORM_HARNESSES_DIR)
    : []) {
    const filePath = joinPathFragments(
      TERRAFORM_HARNESSES_DIR,
      dirName,
      `${dirName}.tf`,
    );
    if (!tree.exists(filePath)) {
      continue; // Not a Harness module directory.
    }

    // Already assigned, by this migration or by hand.
    if (await matchGritQL(tree, filePath, hcl('`allowed_tools = $_`'))) {
      continue;
    }

    if (!(await migrateTerraformModule(tree, filePath))) {
      nextSteps.push(
        divergedMessage(
          filePath,
          'Declare an `allowed_tools` variable (list(string), default []) and assign `allowed_tools = var.allowed_tools` on the `aws_bedrockagentcore_harness` resource.',
        ),
      );
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
