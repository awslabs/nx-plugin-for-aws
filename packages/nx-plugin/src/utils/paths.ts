/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { normalize, relative } from 'path';
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
  return '../'.repeat(levels);
};

/**
 * Gets a safe relative path for vite config outDir that avoids excessive '../' segments
 * that can cause issues on Windows
 */
export const getSafeRelativePathForVite = (
  tree: Tree,
  projectName: string,
  targetPath: string,
): string => {
  const projectConfig = readProjectConfigurationUnqualified(tree, projectName);
  const projectRoot = projectConfig.root;
  
  // For vite config, we need to ensure we get a proper relative path
  // Use the same logic as getRelativePathToRoot but for a specific target
  const projectRootSegments = projectRoot.split('/').filter(Boolean);
  const targetPathSegments = targetPath.split('/').filter(Boolean);
  
  // Count how many levels up we need to go from project root
  const levelsUp = projectRootSegments.length;
  
  // Build the relative path by going up from project root, then down to target
  const upPath = '../'.repeat(levelsUp);
  const downPath = targetPathSegments.join('/');
  
  const result = upPath + downPath;
  
  // Normalize the path to handle any path separator issues
  return normalize(result).replace(/\\/g, '/');
};
