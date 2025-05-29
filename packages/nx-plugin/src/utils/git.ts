/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { joinPathFragments, Tree } from '@nx/devkit';
import { execSync } from 'child_process';
import uniqBy from 'lodash.uniqby';

/**
 * Returns all files from the tree root that are not gitignored (both tracked and untracked)
 */
export const getGitIncludedFiles = (tree: Tree): string[] => {
  return [
    // Git tracked files
    ...execSync('git ls-files --exclude-standard', {
      encoding: 'utf-8',
      cwd: tree.root,
    })
      .split('\n')
      .filter((x) => x),
    // Untracked files that aren't ignored
    ...execSync('git ls-files --others --exclude-standard', {
      encoding: 'utf-8',
      cwd: tree.root,
    })
      .split('\n')
      .filter((x) => x),
  ].filter((f) => tree.exists(f));
};

/**
 * Return whether or not a tree is within a git repo
 */
export const isWithinGitRepo = (tree: Tree): boolean => {
  if (tree.exists('.git')) {
    return true;
  }
  try {
    return execSync('git rev-parse --is-inside-work-tree', {
      encoding: 'utf-8',
      cwd: tree.root,
    }).startsWith('true');
  } catch {
    return false;
  }
};

/**
 * Update a .gitignore file. Will create a new .gitignore file if it does not exist
 */
export const updateGitIgnore = (
  tree: Tree,
  dir: string,
  doUpdate: (patterns: string[]) => string[],
) => {
  const gitIgnorePath = joinPathFragments(dir, '.gitignore');
  const existingPatterns = tree.read(gitIgnorePath, 'utf-8')?.split('\n') ?? [];
  const newPatterns = doUpdate(existingPatterns);
  tree.write(gitIgnorePath, uniqBy(newPatterns, (p) => p).join('\n'));
};
