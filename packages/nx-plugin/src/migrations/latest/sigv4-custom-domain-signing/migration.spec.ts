/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

/** The hook as the generator wrote it before this change */
const OLD_HOOK = readFileSync(
  join(import.meta.dirname, 'old-useSigV4.tsx.fixture'),
  'utf-8',
);
/** The hook as the generator writes it now */
const NEW_HOOK = readFileSync(
  join(
    import.meta.dirname,
    '../../../utils/files/website/hooks/sigv4/useSigV4.tsx.template',
  ),
  'utf-8',
);
const HOOK = 'apps/website/src/hooks/useSigV4.tsx';

describe('sigv4-custom-domain-signing', () => {
  let tree: Tree;

  beforeEach(async () => {
    tree = createTreeUsingTsSolutionSetup();
    addProjectConfiguration(tree, 'website', {
      root: 'apps/website',
      sourceRoot: 'apps/website/src',
    });
    tree.write(HOOK, OLD_HOOK);
    // As the generator left it, formatted
    await formatFilesInSubtree(tree);
  });

  it('should leave the hook as the generator writes it now', async () => {
    await migration(tree);

    const expected = createTreeUsingTsSolutionSetup();
    expected.write(HOOK, NEW_HOOK);
    await formatFilesInSubtree(expected);
    expect(tree.read(HOOK, 'utf-8')).toBe(expected.read(HOOK, 'utf-8'));
  });

  it('should change nothing when run again', async () => {
    await migration(tree);
    const once = tree.read(HOOK, 'utf-8');

    const result = await migration(tree);

    expect(tree.read(HOOK, 'utf-8')).toBe(once);
    expect(result.nextSteps).toEqual([]);
  });

  it('should leave a hook that has diverged, and say so', async () => {
    tree.write(HOOK, '// my own hook\n');

    const result = await migration(tree);

    expect(tree.read(HOOK, 'utf-8')).toBe('// my own hook\n');
    expect(result.nextSteps).toEqual([expect.stringContaining(HOOK)]);
  });
});
