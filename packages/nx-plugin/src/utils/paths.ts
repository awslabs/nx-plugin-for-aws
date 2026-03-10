/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { ProjectConfiguration, Tree } from '@nx/devkit';
import * as path from 'path';
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
  // Create the relative path back to root
  return '../'.repeat(levels);
};

/**
 * Convert an absolute path within a project to a path relative to the project root.
 */
export const toProjectRelativePath = (
  projectConfiguration: ProjectConfiguration,
  absolutePath: string,
): string => {
  return path.relative(projectConfiguration.root, absolutePath);
};
