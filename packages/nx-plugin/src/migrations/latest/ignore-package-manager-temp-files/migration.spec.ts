/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const readGitIgnore = (tree: Tree): string[] =>
  (tree.read('.gitignore', 'utf-8') ?? '').split('\n');

describe('ignore-package-manager-temp-files migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should ignore the temporary files pnpm writes', async () => {
    tree.write('.gitignore', 'node_modules\ndist\n');

    await migration(tree);

    expect(readGitIgnore(tree)).toContain('_tmp_*');
  });

  it('should preserve existing patterns', async () => {
    tree.write('.gitignore', 'node_modules\ndist\n');

    await migration(tree);

    const patterns = readGitIgnore(tree);
    expect(patterns).toContain('node_modules');
    expect(patterns).toContain('dist');
  });

  it('should not duplicate the pattern when already present', async () => {
    tree.write('.gitignore', 'node_modules\n_tmp_*\n');

    await migration(tree);

    expect(readGitIgnore(tree).filter((p) => p === '_tmp_*')).toHaveLength(1);
  });

  it('should create a .gitignore when the workspace has none', async () => {
    tree.delete('.gitignore');

    await migration(tree);

    expect(readGitIgnore(tree)).toContain('_tmp_*');
  });
});
