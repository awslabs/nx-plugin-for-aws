/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type MigrationReturnObject,
  readNxJson,
  type Tree,
  updateNxJson,
} from '@nx/devkit';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { DEFAULT_PARALLEL } from '../../../utils/init.js';

/**
 * New workspaces set `parallel` in `nx.json` so a full build uses the available
 * cores rather than Nx's default of 3. Existing workspaces have no value at all,
 * so this backfills it.
 *
 * A workspace that already declares `parallel` has made a deliberate choice —
 * often to bound memory on a smaller machine — so it is left as it is.
 */
export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  const nxJson = readNxJson(tree);
  if (nxJson && nxJson.parallel === undefined) {
    updateNxJson(tree, { ...nxJson, parallel: DEFAULT_PARALLEL });
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
