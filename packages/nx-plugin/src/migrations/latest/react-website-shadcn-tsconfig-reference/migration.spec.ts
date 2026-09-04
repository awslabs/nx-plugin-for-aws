/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, readJson, type Tree } from '@nx/devkit';
import { REACT_WEBSITE_APP_GENERATOR_INFO } from '../../../ts/react-website/app/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const WEBSITE_ROOT = 'packages/my-website';
const TSCONFIG_APP = `${WEBSITE_ROOT}/tsconfig.app.json`;

/**
 * A shadcn website's `tsconfig.app.json` with the given references, hardcoded
 * rather than produced by running the generator: a migration has to keep
 * applying to the shape that shipped, however far the generator moves after.
 */
const writeWebsite = (
  tree: Tree,
  references: { path: string }[],
  options?: { ux?: string },
) => {
  addProjectConfiguration(tree, '@proj/my-website', {
    root: WEBSITE_ROOT,
    sourceRoot: `${WEBSITE_ROOT}/src`,
    metadata: {
      generator: REACT_WEBSITE_APP_GENERATOR_INFO.id,
      ux: options?.ux ?? 'shadcn',
      framework: 'react',
    } as any,
  });
  tree.write(
    TSCONFIG_APP,
    JSON.stringify(
      { extends: '../../tsconfig.base.json', references },
      null,
      2,
    ),
  );
};

const readReferences = (tree: Tree): string[] =>
  (
    readJson<{ references?: { path: string }[] }>(tree, TSCONFIG_APP)
      .references ?? []
  ).map((ref) => ref.path);

describe('react-website-shadcn-tsconfig-reference migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should remove the duplicate shared shadcn reference, keeping the synced one', async () => {
    writeWebsite(tree, [
      { path: '../common/shadcn/tsconfig.lib.json' },
      { path: '../common/shadcn/tsconfig.json' },
    ]);

    await migration(tree);

    expect(readReferences(tree)).toEqual([
      '../common/shadcn/tsconfig.lib.json',
    ]);
  });

  it('should collapse more than two duplicates', async () => {
    writeWebsite(tree, [
      { path: '../common/shadcn/tsconfig.lib.json' },
      { path: '../common/shadcn/tsconfig.json' },
      { path: '../common/shadcn/tsconfig.json' },
    ]);

    await migration(tree);

    expect(readReferences(tree)).toEqual([
      '../common/shadcn/tsconfig.lib.json',
    ]);
  });

  it('should leave a single reference untouched', async () => {
    writeWebsite(tree, [{ path: '../common/shadcn/tsconfig.lib.json' }]);

    await migration(tree);

    expect(readReferences(tree)).toEqual([
      '../common/shadcn/tsconfig.lib.json',
    ]);
  });

  it("should preserve the user's own references", async () => {
    writeWebsite(tree, [
      { path: '../my-lib/tsconfig.lib.json' },
      { path: '../common/shadcn/tsconfig.lib.json' },
      { path: '../common/shadcn/tsconfig.json' },
      { path: '../other-lib' },
    ]);

    await migration(tree);

    expect(readReferences(tree)).toEqual([
      '../my-lib/tsconfig.lib.json',
      '../common/shadcn/tsconfig.lib.json',
      '../other-lib',
    ]);
  });

  it('should skip websites which do not use shadcn', async () => {
    writeWebsite(
      tree,
      [
        { path: '../common/shadcn/tsconfig.lib.json' },
        { path: '../common/shadcn/tsconfig.json' },
      ],
      { ux: 'cloudscape' },
    );

    await migration(tree);

    expect(readReferences(tree)).toEqual([
      '../common/shadcn/tsconfig.lib.json',
      '../common/shadcn/tsconfig.json',
    ]);
  });

  it('should be idempotent', async () => {
    writeWebsite(tree, [
      { path: '../common/shadcn/tsconfig.lib.json' },
      { path: '../common/shadcn/tsconfig.json' },
    ]);

    await migration(tree);
    const afterFirst = tree.read(TSCONFIG_APP, 'utf-8');
    await migration(tree);

    expect(tree.read(TSCONFIG_APP, 'utf-8')).toBe(afterFirst);
  });
});
