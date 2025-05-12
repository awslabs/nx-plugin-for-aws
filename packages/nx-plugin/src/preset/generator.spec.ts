/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { presetGenerator } from './generator';
import { createTreeUsingTsSolutionSetup, snapshotTreeDir } from '../utils/test';

describe('preset generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should run successfully', async () => {
    await presetGenerator(tree, { addTsPlugin: false });

    snapshotTreeDir(tree, '.');
  });
});
