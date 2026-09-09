/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
  updateJson,
} from '@nx/devkit';
import {
  BIOME_ROLLDOWN_CONFIG_BUNDLE_EXCLUDE,
  formatFilesInSubtree,
  ROLLDOWN_CONFIG_BUNDLE_GLOB,
} from '../../../utils/format.js';
import { updateGitIgnore } from '../../../utils/git.js';

/**
 * Keep rolldown's transient config bundle out of Biome's and git's reach.
 *
 * Loading a `rolldown.config.ts` bundles it to `rolldown.config.<hash>.js` in the
 * config's own directory, imports it, then unlinks it. The `bundle`, `format` and
 * `lint` targets of a project all run concurrently, so a `format` sweeping the
 * project mid-bundle sees a machine-generated file and reports it unformatted —
 * failing the target for no fault of the source. Being git-visible, the file
 * could also be committed, or picked up by `license#sync`, which builds its
 * candidate set from git-visible files rather than from `biome.json`.
 *
 * Guardrails:
 * - The Biome exclude is anchored to the excludes we vend. A workspace whose
 *   `files.includes` has diverged keeps its own list, and is reported via
 *   `nextSteps` instead.
 * - Only projects carrying a `rolldown.config.ts` get the git ignore, matching
 *   where the generator writes it.
 * - Idempotent: both edits are guarded on the pattern already being present.
 */

/** The config filename whose loading produces the transient bundle. */
const ROLLDOWN_CONFIG = 'rolldown.config.ts';

/**
 * Exclude the transient bundle from Biome. Anchored to `!**\/out-tsc`, the
 * build-output exclude the vended list places these next to — without it the list
 * has diverged from the one we vend, so leave it to the user.
 */
const excludeFromBiome = (tree: Tree): string[] => {
  if (!tree.exists('biome.json')) {
    return [];
  }
  let unrecognised = false;
  updateJson(tree, 'biome.json', (biome) => {
    const includes: unknown = biome?.files?.includes;
    if (
      !Array.isArray(includes) ||
      includes.includes(BIOME_ROLLDOWN_CONFIG_BUNDLE_EXCLUDE)
    ) {
      return biome;
    }
    if (!includes.includes('!**/out-tsc')) {
      unrecognised = true;
      return biome;
    }
    return {
      ...biome,
      files: {
        ...biome.files,
        includes: includes.flatMap((include) =>
          include === '!**/out-tsc'
            ? [include, BIOME_ROLLDOWN_CONFIG_BUNDLE_EXCLUDE]
            : [include],
        ),
      },
    };
  });
  return unrecognised
    ? [
        `\`biome.json\`: add \`"${BIOME_ROLLDOWN_CONFIG_BUNDLE_EXCLUDE}"\` to \`files.includes\` so the transient bundle rolldown writes while loading a TypeScript config is never formatted or linted. Its \`files.includes\` has diverged from the vended list, so it was left as it is.`,
      ]
    : [];
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [...excludeFromBiome(tree)];

  for (const [, project] of getProjects(tree)) {
    if (!tree.exists(joinPathFragments(project.root, ROLLDOWN_CONFIG))) {
      continue;
    }
    updateGitIgnore(tree, project.root, (patterns) =>
      patterns.includes(ROLLDOWN_CONFIG_BUNDLE_GLOB)
        ? patterns
        : [...patterns, ROLLDOWN_CONFIG_BUNDLE_GLOB],
    );
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
