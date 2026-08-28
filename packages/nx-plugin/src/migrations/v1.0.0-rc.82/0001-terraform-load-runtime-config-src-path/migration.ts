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
import { TERRAFORM_WEBSITE_RUNTIME_CONFIG_FILE } from '../../../utils/shared-constructs-constants.js';

/**
 * The Terraform `load-runtime-config` target copied
 * `dist/packages/common/terraform/runtime-config.json`, which nothing writes:
 * the vended runtime-config modules aggregate per namespace into the
 * `runtime-config` *directory*, so the website's config lands at
 * `runtime-config/connection.json`. Copying the directory path always failed
 * with ENOENT, so point it at the file the aggregation actually writes.
 *
 * Both target names are rewritten — `load-runtime-config` and the
 * `load:runtime-config` it was cloned from, which is left in place for
 * workspaces that still reference it.
 *
 * How to write a migration:
 * - https://nx.dev/docs/kb/migration-generators
 * - What `nextSteps` means: https://nx.dev/docs/reference/devkit/MigrationReturnObject
 */

const TARGETS = ['load-runtime-config', 'load:runtime-config'];

/** The path the target used to name, which never existed on disk. */
const BROKEN_SRC_FILE = 'dist/packages/common/terraform/runtime-config.json';

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  for (const [projectName, project] of getProjects(tree)) {
    let updated = false;

    for (const targetName of TARGETS) {
      const env = project.targets?.[targetName]?.options?.env;
      // Only the broken path is rewritten, so a workspace that pointed the
      // target somewhere of its own keeps it.
      if (env?.SRC_FILE !== BROKEN_SRC_FILE) {
        continue;
      }
      env.SRC_FILE = TERRAFORM_WEBSITE_RUNTIME_CONFIG_FILE;
      updated = true;
    }

    if (updated) {
      updateProjectConfiguration(tree, projectName, project);
    }
  }

  await formatFilesInSubtree(tree);

  return {};
}
