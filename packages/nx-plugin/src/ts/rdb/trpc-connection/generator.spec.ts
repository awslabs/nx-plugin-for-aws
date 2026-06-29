/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readProjectConfiguration, type Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import { tsRdbTrpcConnectionGenerator } from './generator';

describe('ts#rdb trpc-connection generator', () => {
  let tree: Tree;

  const setupRdbProject = (name = 'db', metadata?: Record<string, unknown>) => {
    tree.write(
      `packages/${name}/project.json`,
      JSON.stringify({
        name,
        root: `packages/${name}`,
        targets: {
          dev: { executor: 'nx:run-commands', continuous: true },
        },
        ...(metadata ? { metadata } : {}),
      }),
    );
  };

  const setupTrpcProject = (name = 'api') => {
    tree.write(
      `packages/${name}/project.json`,
      JSON.stringify({
        name,
        root: `packages/${name}`,
        targets: {
          dev: { executor: 'nx:run-commands', continuous: true },
        },
      }),
    );
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should add rdb dev dependency to trpc dev', async () => {
    setupTrpcProject();
    setupRdbProject();

    await tsRdbTrpcConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });

    expect(readProjectConfiguration(tree, 'api')).toMatchSnapshot();
  });

  it('should not add dependency when source has no dev', async () => {
    tree.write(
      `packages/api/project.json`,
      JSON.stringify({
        name: 'api',
        root: 'packages/api',
        targets: { build: {} },
      }),
    );
    setupRdbProject();

    await tsRdbTrpcConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });

    const config = readProjectConfiguration(tree, 'api');
    expect(config.targets?.['dev']).toBeUndefined();
  });

  it('should generate middleware file for PostgreSQL engine', async () => {
    setupTrpcProject();
    setupRdbProject();

    await tsRdbTrpcConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });

    expect(
      tree.read('packages/api/src/middleware/db.ts', 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should generate middleware file with try/finally for MySQL engine', async () => {
    setupTrpcProject();
    setupRdbProject('db', { engine: 'mysql' });

    await tsRdbTrpcConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });

    expect(
      tree.read('packages/api/src/middleware/db.ts', 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should not overwrite existing middleware file', async () => {
    setupTrpcProject();
    setupRdbProject();
    tree.write('packages/api/src/middleware/db.ts', '// existing content');

    await tsRdbTrpcConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });

    expect(tree.read('packages/api/src/middleware/db.ts', 'utf-8')).toContain(
      '// existing content',
    );
  });

  it('should be idempotent', async () => {
    setupTrpcProject();
    setupRdbProject();

    await tsRdbTrpcConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });
    await tsRdbTrpcConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });

    const config = readProjectConfiguration(tree, 'api');
    const deps = (config.targets?.['dev']?.dependsOn ?? []).filter(
      (d: any) =>
        typeof d === 'object' &&
        d.projects?.includes('db') &&
        d.target === 'dev',
    );
    expect(deps).toHaveLength(1);
  });
});
