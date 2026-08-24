/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  type MigrationReturnObject,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { formatFilesInSubtree } from '../../../utils/format.js';

/**
 * React website projects gained a `load-runtime-config` target so the config
 * can be loaded with the verb syntax (`nx load-runtime-config <project>`),
 * replacing the colon-separated `load:runtime-config` that had to be quoted on
 * the CLI. This clones the existing target under the new name in workspaces
 * generated before the rename, leaving the original in place so any scripts
 * still referencing it keep working.
 */

const OLD_TARGET = 'load:runtime-config';
const NEW_TARGET = 'load-runtime-config';

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  for (const [projectName, project] of getProjects(tree)) {
    const targets = project.targets;
    if (!targets?.[OLD_TARGET] || targets[NEW_TARGET]) {
      // No target to clone, or the new target already exists.
      continue;
    }

    const cloned = structuredClone(targets[OLD_TARGET]);
    // Point the description at the verb syntax for the new target.
    if (cloned.metadata?.description) {
      cloned.metadata.description = cloned.metadata.description.replace(
        new RegExp(`nx run (\\S+):${OLD_TARGET}`, 'g'),
        `nx ${NEW_TARGET} $1`,
      );
    }
    targets[NEW_TARGET] = cloned;

    updateProjectConfiguration(tree, projectName, project);
  }

  await formatFilesInSubtree(tree);

  return {};
}
