/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readProjectConfiguration, Tree } from '@nx/devkit';
export const getRelativePathToRoot = (
  tree: Tree,
  projectName: string
): string => {
  const projectConfig = readProjectConfiguration(tree, projectName);
  const projectRoot = projectConfig.root;
  return getRelativePathToRootByDirectory(projectRoot);
};
export const getRelativePathToRootByDirectory = (directory: string): string => {
  // Count the number of path segments to determine how many '../' we need
  const levels = directory.split('/').filter(Boolean).length;
  // Create the relative path back to root
  return '../'.repeat(levels);
};
