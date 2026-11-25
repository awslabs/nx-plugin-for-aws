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
import { addStarExport } from '../ast.js';
import { esmVars } from '../module-format.js';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../shared-constructs-constants.js';

/**
 * Add the CDK constructs for a private REST API behind an AWS Verified Access door
 */
export const addVerifiedAccessCdkConstructs = async (tree: Tree) => {
  const coreDir = joinPathFragments(
    PACKAGES_DIR,
    SHARED_CONSTRUCTS_DIR,
    'src',
    'core',
  );
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'cdk', 'core'),
    coreDir,
    esmVars(tree),
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );
  for (const file of ['verified-access']) {
    await addStarExport(
      tree,
      joinPathFragments(coreDir, 'index.ts'),
      `./${file}.js`,
    );
  }
};
