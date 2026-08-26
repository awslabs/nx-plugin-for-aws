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
import {
  cdkLambdaRuntime,
  terraformLambdaRuntime,
} from '../../../utils/versions.js';

/**
 * Move the Lambda runtime in existing workspaces onto the single pin both IaC
 * providers now derive from.
 *
 * The two disagreed: CDK named `Runtime.NODEJS_LATEST`, which resolves to
 * `nodejs24.x` against the pinned `aws-cdk-lib`, while Terraform hardcoded
 * `nodejs22.x` — so the same generator with the same options vended a different
 * Node major depending on `--iac`. Terraform also disagreed with itself, the RDB
 * create-db-user handler sitting on `nodejs24.x`.
 *
 * These files are vended `KeepExisting`, so without this an upgraded workspace
 * keeps whichever runtime it was generated with.
 */

/** The runtime today's generators vend, in each provider's spelling. */
const CDK_RUNTIME = cdkLambdaRuntime('node');
const TERRAFORM_RUNTIME = terraformLambdaRuntime('node');

/**
 * The Node runtimes this plugin has vended, which are the only values rewritten.
 *
 * Enumerated rather than "anything older than the pin" so a runtime the user
 * chose themselves is left alone: only a value that came out of our own
 * templates is recognised. `NODEJS_LATEST` is included because it is an alias
 * whose value `aws-cdk-lib` decides, which is the drift this replaces.
 */
const VENDED_CDK_RUNTIMES = [
  'Runtime.NODEJS_LATEST',
  'Runtime.NODEJS_22_X',
  'Runtime.NODEJS_24_X',
] as const;

const VENDED_TERRAFORM_RUNTIMES = ['nodejs22.x', 'nodejs24.x'] as const;

const SHARED_CONSTRUCTS_SRC = `${PACKAGES_DIR}/${SHARED_CONSTRUCTS_DIR}/src`;
const SHARED_TERRAFORM_SRC = `${PACKAGES_DIR}/${SHARED_TERRAFORM_DIR}/src`;

/** Every file under a directory matching a suffix, or [] when it doesn't exist. */
const filesUnder = (tree: Tree, dir: string, suffix: string): string[] => {
  if (!tree.exists(dir)) {
    return [];
  }
  const found: string[] = [];
  const walk = (current: string) => {
    for (const child of tree.children(current)) {
      const full = `${current}/${child}`;
      if (!tree.isFile(full)) {
        walk(full);
      } else if (full.endsWith(suffix)) {
        found.push(full);
      }
    }
  };
  walk(dir);
  return found;
};

/**
 * Rewrite a `runtime` assignment holding one of the runtimes we vended.
 *
 * Matched on the property rather than the file's surrounding shape, so a
 * construct the user has otherwise reworked still has its runtime aligned —
 * which is what keeps this from skipping most real workspaces. A value we never
 * vended is not matched, so their own choice survives.
 *
 * @returns whether anything changed
 */
const alignCdkRuntimes = async (
  tree: Tree,
  filePath: string,
): Promise<boolean> => {
  let changed = false;
  for (const stale of VENDED_CDK_RUNTIMES) {
    if (stale === CDK_RUNTIME) {
      continue; // Already what this release vends.
    }
    // Both the bare `Runtime.X` and the `lambda.Runtime.X` form a
    // namespace-imported template emits, whose prefix is preserved.
    for (const [pattern, replacement] of [
      [stale, CDK_RUNTIME],
      [`lambda.${stale}`, `lambda.${CDK_RUNTIME}`],
    ]) {
      if (
        await applyGritQL(
          tree,
          filePath,
          `\`runtime: ${pattern}\` => \`runtime: ${replacement}\``,
        )
      ) {
        changed = true;
      }
    }
  }
  return changed;
};

/** Rewrite a Terraform `runtime` attribute holding one of the runtimes we vended. */
const alignTerraformRuntimes = async (
  tree: Tree,
  filePath: string,
): Promise<boolean> => {
  let changed = false;
  for (const stale of VENDED_TERRAFORM_RUNTIMES) {
    if (stale === TERRAFORM_RUNTIME) {
      continue;
    }
    if (
      await applyGritQL(
        tree,
        filePath,
        `language hcl\n\`runtime = "${stale}"\` => \`runtime = "${TERRAFORM_RUNTIME}"\``,
      )
    ) {
      changed = true;
    }
  }
  return changed;
};

/**
 * A file still holding a runtime we vended after the rewrites ran, which means
 * the assignment is written in a shape the patterns above don't reach.
 */
const stillStale = async (
  tree: Tree,
  filePath: string,
  patterns: readonly string[],
): Promise<boolean> => {
  for (const pattern of patterns) {
    if (await matchGritQL(tree, filePath, pattern)) {
      return true;
    }
  }
  return false;
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];
  const skipped: string[] = [];

  for (const filePath of filesUnder(tree, SHARED_CONSTRUCTS_SRC, '.ts')) {
    await alignCdkRuntimes(tree, filePath);
    // Matched on the runtime reference alone rather than the `runtime:` property,
    // so one reached through a local alias or a shared props object is reported
    // rather than passing as aligned.
    const stale = VENDED_CDK_RUNTIMES.filter((r) => r !== CDK_RUNTIME).map(
      (r) => `\`${r}\``,
    );
    if (await stillStale(tree, filePath, stale)) {
      skipped.push(filePath);
    }
  }

  for (const filePath of filesUnder(tree, SHARED_TERRAFORM_SRC, '.tf')) {
    await alignTerraformRuntimes(tree, filePath);
    const stale = VENDED_TERRAFORM_RUNTIMES.filter(
      (r) => r !== TERRAFORM_RUNTIME,
    ).map((r) => `language hcl\n\`runtime = "${r}"\``);
    if (await stillStale(tree, filePath, stale)) {
      skipped.push(filePath);
    }
  }

  if (skipped.length > 0) {
    nextSteps.push(
      `The following files still declare a Lambda runtime this release no longer vends, in a shape this migration could not rewrite - set it to \`${CDK_RUNTIME}\` (CDK) or \`"${TERRAFORM_RUNTIME}"\` (Terraform) by hand: ${skipped.join(', ')}`,
    );
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
