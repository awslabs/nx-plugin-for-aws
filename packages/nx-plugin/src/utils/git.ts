/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { execSync } from 'child_process';

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
  ];
};
