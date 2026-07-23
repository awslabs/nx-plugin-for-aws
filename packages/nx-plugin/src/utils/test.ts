/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  joinPathFragments,
  readJson,
  type Tree,
  updateJson,
  writeJson,
} from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { expect } from 'vitest';
import { DEFAULT_BIOME_CONFIG } from './format';

/**
 * Create a workspace tree configured so that nx's `isUsingTsSolutionSetup`
 * reports `true`, matching the workspaces our preset generates. Rather than
 * mocking nx internals, we set up the real markers it checks for:
 * - package manager workspaces enabled (`pnpm-workspace.yaml` with `packages`)
 * - a root `tsconfig.json` extending `tsconfig.base.json` with empty `include`
 * - `composite: true` in `tsconfig.base.json`
 * - a root `package.json` with `type: module`, matching the ESM default the
 *   preset establishes
 */
export const createTreeUsingTsSolutionSetup = (): Tree => {
  const tree = createTreeWithEmptyWorkspace();

  tree.write('pnpm-workspace.yaml', `packages:\n  - packages/*`);

  // Write both workspace markers so package-manager detection finds workspaces
  // enabled whether tests run via pnpm or npm/npx.
  updateJson(tree, 'package.json', (json) => ({
    ...json,
    type: 'module',
    workspaces: ['packages/*'],
  }));

  const baseTsConfig = readJson(tree, 'tsconfig.base.json');
  writeJson(tree, 'tsconfig.base.json', {
    ...baseTsConfig,
    compilerOptions: { ...baseTsConfig.compilerOptions, composite: true },
  });
  writeJson(tree, 'tsconfig.json', {
    extends: './tsconfig.base.json',
    files: [],
    include: [],
    references: [],
  });

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
