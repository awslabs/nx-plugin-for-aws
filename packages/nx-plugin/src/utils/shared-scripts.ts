/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { joinPathFragments, type Tree } from '@nx/devkit';
import tsProjectGenerator from '../ts/lib/generator';
import {
  PACKAGES_DIR,
  SHARED_SCRIPTS_DIR,
  SHARED_SCRIPTS_NAME,
} from './shared-constructs-constants';

/**
 * Lazily creates the shared scripts package at packages/common/scripts/.
 */
export async function ensureSharedScriptsProject(tree: Tree): Promise<void> {
  const scriptsDir = joinPathFragments(PACKAGES_DIR, SHARED_SCRIPTS_DIR);
  if (tree.exists(joinPathFragments(scriptsDir, 'project.json'))) {
    return;
  }
  await tsProjectGenerator(tree, {
    name: SHARED_SCRIPTS_NAME,
    directory: PACKAGES_DIR,
    subDirectory: SHARED_SCRIPTS_DIR,
  });
  tree.delete(joinPathFragments(scriptsDir, 'src'));
}
