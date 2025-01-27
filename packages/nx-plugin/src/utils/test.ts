/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { vi } from 'vitest';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree } from '@nx/devkit';
import solutionSetup from '@nx/js/src/utils/typescript/ts-solution-setup';

export const createTreeUsingTsSolutionSetup = (): Tree => {
  vi.spyOn(solutionSetup, 'isUsingTsSolutionSetup').mockImplementation(
    () => true
  );

  const tree = createTreeWithEmptyWorkspace();

  tree.write('tsconfig.json', '{}');
  return tree;
};
