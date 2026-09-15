/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readProjectConfiguration, type Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import { tsRdbTrpcConnectionGenerator } from './generator.js';

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

  const INIT_TS = `import { initTRPC } from '@trpc/server';
import {
  createErrorPlugin,
  createLoggerPlugin,
  IMiddlewareContext,
} from './middleware/index.js';

export type Context = IMiddlewareContext;

export const t = initTRPC.context<Context>().create();

export const publicProcedure = t.procedure
  .concat(createLoggerPlugin())
  .concat(createErrorPlugin());
`;

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
    tree.write(`packages/${name}/src/init.ts`, INIT_TS);
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

  it('should widen the root context in init.ts', async () => {
    setupTrpcProject();
    setupRdbProject();

    await tsRdbTrpcConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });

    expect(tree.read('packages/api/src/init.ts', 'utf-8')).toMatchSnapshot();
  });

  it('should widen the root context once per database', async () => {
    setupTrpcProject();
    setupRdbProject();
    setupRdbProject('other-db');

    await tsRdbTrpcConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });
    await tsRdbTrpcConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'other-db',
    });
    // Re-running both connections must not append duplicate intersections
    await tsRdbTrpcConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });
    await tsRdbTrpcConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'other-db',
    });

    const init = tree.read('packages/api/src/init.ts', 'utf-8')!;
    expect(init.match(/IDbContext/g)).toHaveLength(2);
    expect(init.match(/IOtherDbContext/g)).toHaveLength(2);
    expect(init).toMatchSnapshot();
  });

  it('should preserve user edits to init.ts on re-run', async () => {
    setupTrpcProject();
    setupRdbProject();

    await tsRdbTrpcConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });

    const userEdited = tree
      .read('packages/api/src/init.ts', 'utf-8')!
      .replace(
        'export const t = initTRPC',
        `export interface IUserContext {\n  userId: string;\n}\n\nexport const t = initTRPC`,
      )
      .replace(
        'export type Context = ',
        'export type Context = IUserContext & ',
      );
    tree.write('packages/api/src/init.ts', userEdited);

    await tsRdbTrpcConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });

    const init = tree.read('packages/api/src/init.ts', 'utf-8')!;
    expect(init).toContain('IUserContext');
    expect(init).toContain('userId: string');
    expect(init.match(/IDbContext/g)).toHaveLength(2);
  });

  it('should not modify init.ts when it is absent', async () => {
    setupTrpcProject();
    tree.delete('packages/api/src/init.ts');
    setupRdbProject();

    await tsRdbTrpcConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });

    expect(tree.exists('packages/api/src/init.ts')).toBe(false);
    expect(tree.exists('packages/api/src/middleware/db.ts')).toBe(true);
  });
});
