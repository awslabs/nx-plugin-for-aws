/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { declareDependencies } from '../../../utils/declared-dependencies.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { addIdentityInfra } from '../../../utils/identity-constructs/identity-constructs.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../../utils/shared-constructs.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const PATH = 'packages/common/constructs/src/core/user-identity.ts';
/** The construct as the generator wrote it before this change */
const OLD = readFileSync(
  join(import.meta.dirname, 'old-user-identity.ts.fixture'),
  'utf-8',
);

describe('user-identity-callback-urls', () => {
  let tree: Tree;
  let generated: string;

  beforeEach(async () => {
    tree = createTreeUsingTsSolutionSetup();
    await sharedConstructsGenerator(
      tree,
      { iac: 'cdk' },
      declareDependencies()({ ts: [...SHARED_CONSTRUCTS_DEPENDENCIES] }),
    );
    await addIdentityInfra(tree, {
      iac: 'cdk',
      cognitoDomain: 'test',
      allowSignup: true,
      localCallbackPorts: [4200],
    });
    generated = tree.read(PATH, 'utf-8') ?? '';
    tree.write(PATH, OLD);
    // As formatted in a workspace, where the migration formats too
    await formatFilesInSubtree(tree);
    const formatted = createTreeUsingTsSolutionSetup();
    formatted.write(PATH, generated);
    await formatFilesInSubtree(formatted);
    generated = formatted.read(PATH, 'utf-8') ?? '';
  });

  it('should leave the construct as the generator writes it now', async () => {
    await migration(tree);

    expect(tree.read(PATH, 'utf-8')).toBe(generated);
  });

  it('should change nothing when run again', async () => {
    await migration(tree);

    const result = await migration(tree);

    expect(tree.read(PATH, 'utf-8')).toBe(generated);
    expect(result.nextSteps).toEqual([]);
  });

  it('should leave a construct that has diverged, and say so', async () => {
    tree.write(PATH, '// my own identity\n');

    const result = await migration(tree);

    expect(tree.read(PATH, 'utf-8')).toBe('// my own identity\n');
    expect(result.nextSteps).toEqual([expect.stringContaining(PATH)]);
  });
});
