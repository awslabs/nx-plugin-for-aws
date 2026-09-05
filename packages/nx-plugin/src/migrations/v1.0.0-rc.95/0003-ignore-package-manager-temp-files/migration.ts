/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { updateGitIgnore } from '../../../utils/git.js';

/** The temporary files pnpm writes while materialising packages. */
const TEMP_FILE_PATTERN = '_tmp_*';

/**
 * pnpm creates `_tmp_<pid>_<hash>` files at the workspace root while it
 * materialises packages. Left unignored, Nx's watcher invalidates the project
 * graph on every install, so a watch-mode `dev` target running at the time
 * rebuilds the graph continuously and never starts the command it wraps.
 */
export default async function migration(tree: Tree): Promise<void> {
  // Only pnpm writes these, so key off its lockfile rather than the workspace
  // file — a workspace on another package manager may still carry one.
  if (!tree.exists('pnpm-lock.yaml')) {
    return;
  }

  updateGitIgnore(tree, '.', (patterns) =>
    patterns.includes(TEMP_FILE_PATTERN)
      ? patterns
      : [...patterns, TEMP_FILE_PATTERN],
  );

  await formatFilesInSubtree(tree);
}
