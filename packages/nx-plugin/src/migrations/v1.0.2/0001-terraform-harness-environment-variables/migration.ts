/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
} from '@nx/devkit';
import { formatFilesInSubtree } from '../../../utils/format.js';
import {
  PACKAGES_DIR,
  SHARED_TERRAFORM_DIR,
} from '../../../utils/shared-constructs-constants.js';

/**
 * Stop each vended Terraform AgentCore Harness app module
 * (`app/harnesses/<name>/<name>.tf`) sending a null `environment_variables`.
 *
 * The service stores no environment variables as an empty map and returns one,
 * so a null fails the apply with "inconsistent values for sensitive attribute"
 * once the Harness has already been created, leaving it tainted. Every
 * subsequent apply fails the same way.
 *
 * Modules whose assignment has been edited are left untouched and reported via
 * `nextSteps`.
 */

const TERRAFORM_HARNESS_APP_DIR = `${PACKAGES_DIR}/${SHARED_TERRAFORM_DIR}/src/app/harnesses`;

/** The assignment the generator used to write. */
const NULLABLE_ASSIGNMENT = 'environment_variables = var.environment_variables';

/** What it becomes, so the value sent matches what the service returns. */
const COALESCED_ASSIGNMENT =
  'environment_variables = coalesce(var.environment_variables, {})';

const divergedMessage = (filePath: string) =>
  `${filePath}: its environment_variables assignment has been edited, so it was left as it is. Change it to \`${COALESCED_ASSIGNMENT}\` — the AgentCore service returns an empty map when a Harness has no environment variables, and sending null fails the apply after the Harness has been created.`;

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];
  let migrated = false;

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

    const contents = tree.read(filePath, 'utf-8') ?? '';

    if (contents.includes(COALESCED_ASSIGNMENT)) {
      continue; // Already migrated, so a re-run is a no-op.
    }

    if (!contents.includes(NULLABLE_ASSIGNMENT)) {
      nextSteps.push(divergedMessage(filePath));
      continue;
    }

    tree.write(
      filePath,
      contents.replace(NULLABLE_ASSIGNMENT, COALESCED_ASSIGNMENT),
    );
    migrated = true;
  }

  if (migrated) {
    await formatFilesInSubtree(tree, TERRAFORM_HARNESS_APP_DIR);
  }

  return { nextSteps };
}
