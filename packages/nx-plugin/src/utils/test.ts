/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { vi, expect } from 'vitest';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { joinPathFragments, Tree } from '@nx/devkit';
import solutionSetup from '@nx/js/src/utils/typescript/ts-solution-setup';

export const createTreeUsingTsSolutionSetup = (): Tree => {
  vi.spyOn(solutionSetup, 'isUsingTsSolutionSetup').mockImplementation(
    () => true,
  );

  const tree = createTreeWithEmptyWorkspace();

  tree.write('pnpm-workspace.yaml', `packages:\n  - packages/*`);

  tree.write('tsconfig.json', '{}');
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
