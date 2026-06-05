/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { joinPathFragments, type Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import solutionSetup from '@nx/js/src/utils/typescript/ts-solution-setup';
import { expect, vi } from 'vitest';
import { DEFAULT_BIOME_CONFIG } from './format';

export const createTreeUsingTsSolutionSetup = (): Tree => {
  vi.spyOn(solutionSetup, 'isUsingTsSolutionSetup').mockImplementation(
    () => true,
  );

  const tree = createTreeWithEmptyWorkspace();

  tree.write('pnpm-workspace.yaml', `packages:\n  - packages/*`);

  tree.write('tsconfig.json', '{}');
  // The preset always writes biome.json at the workspace root, so mirror that
  // here for realistic lint-target configuration.
  tree.write('biome.json', JSON.stringify(DEFAULT_BIOME_CONFIG, null, 2));
  return tree;
};

/**
 * Snapshot all files within a directory in the given tree
 */
export const snapshotTreeDir = (tree: Tree, dir: string) => {
  if (tree.isFile(dir)) {
    expect(tree.read(dir, 'utf-8')).toMatchSnapshot(dir);
  } else {
    tree
      .children(dir)
      .forEach((subDir) =>
        snapshotTreeDir(tree, joinPathFragments(dir, subDir)),
      );
  }
};
