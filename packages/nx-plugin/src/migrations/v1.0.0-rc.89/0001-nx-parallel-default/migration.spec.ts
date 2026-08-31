/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readNxJson, type Tree, updateNxJson } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import migration from './migration';

describe('nx-parallel-default migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    updateNxJson(tree, { ...readNxJson(tree), parallel: undefined });
  });

  it('should set parallel when the workspace declares no value', async () => {
    await migration(tree);
    expect(readNxJson(tree)?.parallel).toBe(8);
  });

  it('should preserve an existing parallel value', async () => {
    updateNxJson(tree, { ...readNxJson(tree), parallel: 2 });

    await migration(tree);

    expect(readNxJson(tree)?.parallel).toBe(2);
  });

  it('should leave the rest of nx.json untouched', async () => {
    const before = readNxJson(tree);

    await migration(tree);

    expect(readNxJson(tree)).toEqual({ ...before, parallel: 8 });
  });

  it('should be idempotent', async () => {
    await migration(tree);
    const afterFirstRun = tree.read('nx.json')!.toString();

    await migration(tree);

    expect(tree.read('nx.json')!.toString()).toBe(afterFirstRun);
  });
});
