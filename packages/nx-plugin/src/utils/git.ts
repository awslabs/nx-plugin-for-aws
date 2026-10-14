/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { joinPathFragments, type Tree } from '@nx/devkit';
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
 *
 * A trailing newline is kept rather than handed to `doUpdate` as an empty
 * pattern, which the de-duplication below would otherwise merge into an
 * earlier blank line and drop. When the update adds and removes nothing the
 * file is left untouched, so re-running a caller is a no-op.
 */
export const updateGitIgnore = (
  tree: Tree,
  dir: string,
  doUpdate: (patterns: string[]) => string[],
) => {
  const gitIgnorePath = joinPathFragments(dir, '.gitignore');
  const existing = tree.read(gitIgnorePath, 'utf-8');
  const hasTrailingNewline = existing?.endsWith('\n') ?? false;
  const existingPatterns =
    existing === null
      ? []
      : (hasTrailingNewline ? existing.slice(0, -1) : existing).split('\n');
  const newPatterns = uniqBy(doUpdate([...existingPatterns]), (p) => p);

  if (existing !== null) {
    const existingSet = new Set(existingPatterns);
    const newSet = new Set(newPatterns);
    if (
      newPatterns.every((p) => existingSet.has(p)) &&
      existingPatterns.every((p) => newSet.has(p))
    ) {
      return;
    }
  }

  tree.write(
    gitIgnorePath,
    newPatterns.join('\n') + (hasTrailingNewline ? '\n' : ''),
  );
};
