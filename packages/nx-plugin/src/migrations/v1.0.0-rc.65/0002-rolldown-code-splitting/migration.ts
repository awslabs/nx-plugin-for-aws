/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
} from '@nx/devkit';
import { applyGritQL } from '../../../utils/ast';
import { formatFilesInSubtree } from '../../../utils/format';

/**
 * Move generated rolldown configs onto `codeSplitting: false`.
 *
 * rolldown deprecated the `inlineDynamicImports` output option in favour of
 * `codeSplitting`, and warns once per bundle entry — so a workspace with several
 * bundled projects printed the warning many times over on every build. Both
 * spellings ask for the same thing: the whole bundle in a single file, which is
 * what the vended Lambda and container bundles need.
 *
 * Guardrails:
 * - Both patterns are anchored to a rolldown `output` object and scoped with
 *   `some` to its direct properties, so an object of the user's own that happens
 *   to carry the same key is left alone. `inlineDynamicImports: false` is also
 *   left alone: it means the opposite, so a user who set it deliberately keeps it.
 * - Where an output already carries `codeSplitting`, the deprecated option is
 *   dropped rather than renamed, so the rewrite can't produce a duplicate key.
 * - Idempotent: neither pattern matches once the option is gone.
 */

/**
 * Rename the deprecated option, where the output does not already set
 * `codeSplitting`.
 */
const RENAME_PATTERN = `\`output: { $props }\` where {
  $props <: some \`inlineDynamicImports: true\` as $deprecated,
  $props <: not some \`codeSplitting: $_\`,
  $deprecated => \`codeSplitting: false\`
}`;

/**
 * Drop the deprecated option where `codeSplitting` is already set — renaming it
 * would leave the output with the key twice.
 */
const DROP_PATTERN = `\`output: { $props }\` where {
  $props <: some \`codeSplitting: $_\`,
  $props <: some \`inlineDynamicImports: true\` as $deprecated,
  $deprecated => .
}`;

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  for (const project of getProjects(tree).values()) {
    const configPath = joinPathFragments(project.root, 'rolldown.config.ts');
    if (!tree.exists(configPath)) {
      continue;
    }
    for (const pattern of [RENAME_PATTERN, DROP_PATTERN]) {
      await applyGritQL(tree, configPath, pattern);
    }
  }

  await formatFilesInSubtree(tree);

  return {};
}
