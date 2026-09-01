/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import * as devkit from '@nx/devkit';
import { readJson, type Tree, updateJson } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import { TS_VERSIONS } from '../../../utils/versions';
import migration from './migration';

const VENDED_EXPRESS = TS_VERSIONS.express;

describe('react-website-nx-react-express-override migration', () => {
  let tree: Tree;

  const usePackageManager = (pkgMgr: 'npm' | 'yarn' | 'pnpm' | 'bun') =>
    vi.spyOn(devkit, 'detectPackageManager').mockReturnValue(pkgMgr);

  // A workspace with a website carries `@nx/react` at the root.
  const withWebsite = () =>
    updateJson(tree, 'package.json', (json) => ({
      ...json,
      devDependencies: { ...json.devDependencies, '@nx/react': '23.1.2' },
    }));

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    usePackageManager('npm');
  });

  it('should pin express under @nx/react for an npm workspace with a website', async () => {
    withWebsite();

    await migration(tree);

    expect(readJson(tree, 'package.json').overrides).toEqual({
      '@nx/react': { express: VENDED_EXPRESS },
    });
  });

  it('should preserve other overrides and sibling keys', async () => {
    withWebsite();
    updateJson(tree, 'package.json', (json) => ({
      ...json,
      overrides: {
        zod: '4.3.0',
        '@nx/react': { 'some-other-peer': '1.0.0' },
      },
    }));

    await migration(tree);

    expect(readJson(tree, 'package.json').overrides).toEqual({
      zod: '4.3.0',
      '@nx/react': {
        'some-other-peer': '1.0.0',
        express: VENDED_EXPRESS,
      },
    });
  });

  it.each(['pnpm', 'yarn', 'bun'] as const)(
    'should not add an override on %s, which only warns',
    async (pkgMgr) => {
      usePackageManager(pkgMgr);
      withWebsite();

      await migration(tree);

      expect(readJson(tree, 'package.json').overrides).toBeUndefined();
    },
  );

  it('should not add an override to a workspace with no website', async () => {
    await migration(tree);

    expect(readJson(tree, 'package.json').overrides).toBeUndefined();
  });

  it('should keep a version the user pinned deliberately', async () => {
    withWebsite();
    updateJson(tree, 'package.json', (json) => ({
      ...json,
      overrides: { '@nx/react': { express: '4.21.2' } },
    }));

    const result = await migration(tree);

    expect(readJson(tree, 'package.json').overrides['@nx/react'].express).toBe(
      '4.21.2',
    );
    expect(result.nextSteps).toHaveLength(0);
  });

  it('should skip and report an @nx/react override pinned as a string', async () => {
    withWebsite();
    updateJson(tree, 'package.json', (json) => ({
      ...json,
      overrides: { '@nx/react': '23.1.1' },
    }));

    const result = await migration(tree);

    expect(readJson(tree, 'package.json').overrides['@nx/react']).toBe(
      '23.1.1',
    );
    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps[0]).toContain(VENDED_EXPRESS);
  });

  it('should be idempotent', async () => {
    withWebsite();

    await migration(tree);
    const afterFirst = tree.read('package.json', 'utf-8');
    await migration(tree);

    expect(tree.read('package.json', 'utf-8')).toBe(afterFirst);
  });
});
