/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
} from '@nx/devkit';
import {
  PACKAGES_DIR,
  SHARED_SCRIPTS_DIR,
} from './shared-constructs-constants';
import { ensureSharedScriptsProject } from './shared-scripts';
import { withVersions } from './versions';

/**
 * Ensures the shared scripts package exists and adds RDB local-dev scripts
 * to packages/common/scripts/src/rdb/. Used by ts#rdb.
 *
 * Engine-agnostic scripts (pull-image, start-container) are always vended.
 * Only the wait-for-db script for the requested engine is vended so that
 * projects do not reference database client packages they don't install.
 * The engine-specific file names allow postgres and mysql projects to
 * coexist in the same workspace.
 */
export async function sharedRdbScriptsGenerator(
  tree: Tree,
  engine: 'postgres' | 'mysql',
): Promise<void> {
  await ensureSharedScriptsProject(tree);

  const rdbScriptsDir = joinPathFragments(
    import.meta.dirname,
    'files',
    SHARED_SCRIPTS_DIR,
    'src',
    'rdb',
  );
  const targetDir = joinPathFragments(
    PACKAGES_DIR,
    SHARED_SCRIPTS_DIR,
    'src',
    'rdb',
  );

  generateFiles(
    tree,
    joinPathFragments(rdbScriptsDir, 'shared'),
    targetDir,
    {},
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );
  generateFiles(
    tree,
    joinPathFragments(rdbScriptsDir, engine),
    targetDir,
    {},
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  addDependenciesToPackageJson(tree, {}, withVersions(['tsx']));
}
