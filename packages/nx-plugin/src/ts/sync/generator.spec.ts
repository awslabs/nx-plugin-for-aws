/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { TS_SYNC_GENERATOR_INFO, syncGeneratorGenerator } from './generator';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { addProjectConfiguration, readJson } from '@nx/devkit';

describe('ts-sync generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const writeJson = (path: string, value: unknown) =>
    tree.write(path, JSON.stringify(value, null, 2));

  it('should add missing base paths to tsconfigs that define paths', async () => {
    writeJson('tsconfig.base.json', {
      compilerOptions: {
        paths: {
          ':shared': ['packages/shared/src/index.ts'],
          '@shared/*': ['packages/shared/src/*'],
        },
      },
    });

    addProjectConfiguration(tree, 'proj', {
      root: 'packages/proj',
      targets: {},
    });

    writeJson('packages/proj/tsconfig.json', {
      compilerOptions: {
        paths: {
          '@local/*': ['src/*'],
        },
      },
    });
    writeJson('packages/proj/tsconfig.lib.json', {
      compilerOptions: {
        paths: {
          '@local/*': ['src/*'],
        },
      },
    });
    writeJson('packages/proj/tsconfig.app.json', {
      compilerOptions: {
        module: 'esnext',
      },
    });

    const result = await syncGeneratorGenerator(tree);

    expect(
      readJson<Record<string, any>>(tree, 'packages/proj/tsconfig.json')
        .compilerOptions.paths,
    ).toEqual({
      '@local/*': ['src/*'],
      ':shared': ['packages/shared/src/index.ts'],
      '@shared/*': ['packages/shared/src/*'],
    });

    expect(
      readJson<Record<string, any>>(tree, 'packages/proj/tsconfig.lib.json')
        .compilerOptions.paths,
    ).toEqual({
      '@local/*': ['src/*'],
      ':shared': ['packages/shared/src/index.ts'],
      '@shared/*': ['packages/shared/src/*'],
    });

    expect(
      readJson<Record<string, any>>(tree, 'packages/proj/tsconfig.app.json')
        .compilerOptions.paths,
    ).toBeUndefined();

    expect(result).toHaveProperty('outOfSyncMessage');
    expect((result as any).outOfSyncMessage).toContain(
      'packages/proj/tsconfig.json',
    );
    expect((result as any).outOfSyncMessage).toContain(':shared');
  });

  it('should do nothing when tsconfig paths are not configured', async () => {
    writeJson('tsconfig.base.json', {
      compilerOptions: {
        paths: {
          ':shared': ['packages/shared/src/index.ts'],
        },
      },
    });

    addProjectConfiguration(tree, 'proj', {
      root: 'packages/proj',
      targets: {},
    });

    writeJson('packages/proj/tsconfig.json', {
      compilerOptions: {
        target: 'esnext',
      },
    });

    const result = await syncGeneratorGenerator(tree);

    expect(
      readJson<Record<string, any>>(tree, 'packages/proj/tsconfig.json')
        .compilerOptions.paths,
    ).toBeUndefined();
    expect(result).toEqual({});
  });

  it('should add generator metric to app.ts', async () => {
    writeJson('tsconfig.base.json', {
      compilerOptions: {
        paths: {
          ':shared': ['packages/shared/src/index.ts'],
        },
      },
    });

    await sharedConstructsGenerator(tree, { iacProvider: 'CDK' });

    await syncGeneratorGenerator(tree);

    expectHasMetricTags(tree, TS_SYNC_GENERATOR_INFO.metric);
  });
});
