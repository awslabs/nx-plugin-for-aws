/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
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

/**
 * Ensures the shared scripts package exists and adds RDB local-dev scripts
 * to packages/common/scripts/src/rdb/. Used by ts#rdb. Scripts read all
 * config at runtime from config.json so a single set serves all database engines.
 */
export async function sharedRdbScriptsGenerator(tree: Tree): Promise<void> {
  await ensureSharedScriptsProject(tree);

  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', SHARED_SCRIPTS_DIR, 'src', 'rdb'),
    joinPathFragments(PACKAGES_DIR, SHARED_SCRIPTS_DIR, 'src', 'rdb'),
    {},
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );
}
