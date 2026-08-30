/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

// Spelled out rather than read from the live pin, so these keep asserting what
// the migration is for once the vended runtime minor moves on.
const MINOR = '3.14';

describe('python version drop exact patch migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  // `3.14.7` has no macOS build, so uv cannot resolve it there.
  it('should drop the patch at the workspace root', async () => {
    tree.write('.python-version', `${MINOR}.7\n`);

    await migration(tree);

    expect(tree.read('.python-version', 'utf-8')?.trim()).toEqual(MINOR);
  });

  // uv writes one per project too, and a project left behind fails on its own.
  it('should drop the patch in every project', async () => {
    tree.write('.python-version', `${MINOR}.7\n`);
    tree.write('packages/api/.python-version', `${MINOR}.0\n`);
    tree.write('packages/agent/.python-version', `${MINOR}.4\n`);

    await migration(tree);

    for (const path of [
      '.python-version',
      'packages/api/.python-version',
      'packages/agent/.python-version',
    ]) {
      expect(tree.read(path, 'utf-8')?.trim()).toEqual(MINOR);
    }
  });

  it('should leave a file already on the bare minor alone', async () => {
    tree.write('.python-version', `${MINOR}\n`);

    await migration(tree);

    expect(tree.read('.python-version', 'utf-8')?.trim()).toEqual(MINOR);
  });

  // A different minor is the user's choice of interpreter, not a patch to drop.
  it('should leave another minor alone', async () => {
    tree.write('.python-version', '3.11.9\n');

    await migration(tree);

    expect(tree.read('.python-version', 'utf-8')?.trim()).toEqual('3.11.9');
  });

  it('should be idempotent', async () => {
    tree.write('.python-version', `${MINOR}.7\n`);

    await migration(tree);
    const once = tree.read('.python-version', 'utf-8');
    await migration(tree);

    expect(tree.read('.python-version', 'utf-8')).toEqual(once);
  });
});
