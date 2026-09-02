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
 * pnpm writes `_tmp_<pid>_<hash>` files at the workspace root while it
 * materialises packages into the virtual store.
 *
 * Nx watches the workspace, and an unignored file appearing and vanishing
 * invalidates the project graph. So a watch-mode `dev` target running while any
 * install happens — the `dev` cascade installing a dependency, or a generator
 * run in another terminal — rebuilds the graph continuously and never starts
 * the command it wraps.
 */
export default async function migration(tree: Tree): Promise<void> {
  updateGitIgnore(tree, '.', (patterns) =>
    patterns.includes(TEMP_FILE_PATTERN)
      ? patterns
      : [...patterns, TEMP_FILE_PATTERN],
  );

  await formatFilesInSubtree(tree);
}
