/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { dirname, join } from 'node:path';
import { joinPathFragments, type Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { expect, vi } from 'vitest';
import { DEFAULT_BIOME_CONFIG } from './format';

// Resolve @nx/js' internal ts-solution-setup module by filesystem path. It is
// not part of the package's exports map, so it cannot be imported by subpath,
// but generators reference it internally and our tests need to control its
// isUsingTsSolutionSetup behaviour. package.json IS in the exports map.
const nxJsRoot = dirname(require.resolve('@nx/js/package.json'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const solutionSetup = require(
  join(nxJsRoot, 'dist/src/utils/typescript/ts-solution-setup'),
);

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
