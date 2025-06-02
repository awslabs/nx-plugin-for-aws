/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { readProjectConfigurationUnqualified } from './nx';

export const getRelativePathToRoot = (
  tree: Tree,
  projectName: string,
): string => {
  const projectConfig = readProjectConfigurationUnqualified(tree, projectName);
  const projectRoot = projectConfig.root;
  return getRelativePathToRootByDirectory(projectRoot);
};

export const getRelativePathToRootByDirectory = (directory: string): string => {
  // Count the number of path segments to determine how many '../' we need
  const levels = directory.split('/').filter(Boolean).length;
  // Create the relative path back to root, but limit excessive paths that can confuse bundlers
  // If we have more than 10 levels deep, something is likely wrong (e.g., Windows temp paths)
  // In such cases, use a simpler relative path
  if (levels > 10) {
    return './';
  }
  return '../'.repeat(levels);
};
