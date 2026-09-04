/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { TS_RDB_TRPC_CONNECTION_GENERATOR_INFO } from '../../../ts/rdb/trpc-connection/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const INIT_PATH = 'packages/api/src/init.ts';

// The shape the tRPC generator vends, before this change: `Context` never
// included any connected database's context interface.
const PRE_FIX_INIT = `import { initTRPC } from '@trpc/server';
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

const middlewareContent = (
  namePascal: string,
  nameCamel: string,
) => `import { getPrisma } from '@proj/${nameCamel}';
import { initTRPC } from '@trpc/server';

export interface I${namePascal}Context {
  ${nameCamel}?: Awaited<ReturnType<typeof getPrisma>>;
}
`;

describe('trpc-rdb-connection-context migration', () => {
  let tree: Tree;

  const setupApi = (
    connections: { name: string; pascal: string; camel: string }[],
    init: string | null = PRE_FIX_INIT,
  ) => {
    addProjectConfiguration(tree, 'api', {
      name: 'api',
      root: 'packages/api',
      metadata: {
        components: connections.map((connection) => ({
          generator: TS_RDB_TRPC_CONNECTION_GENERATOR_INFO.id,
          path: `src/middleware/${connection.name}.ts`,
          name: connection.camel,
        })),
      } as any,
    });
    if (init !== null) {
      tree.write(INIT_PATH, init);
    }
    for (const connection of connections) {
      tree.write(
        `packages/api/src/middleware/${connection.name}.ts`,
        middlewareContent(connection.pascal, connection.camel),
      );
    }
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should widen the root context for a connected database', async () => {
    setupApi([{ name: 'my-db', pascal: 'MyDb', camel: 'myDb' }]);

    const result = await migration(tree);

    expect(tree.read(INIT_PATH, 'utf-8')).toMatchSnapshot();
    expect(result.nextSteps).toEqual([]);
  });

  it('should widen the root context for every connected database', async () => {
    setupApi([
      { name: 'my-db', pascal: 'MyDb', camel: 'myDb' },
      { name: 'other-db', pascal: 'OtherDb', camel: 'otherDb' },
    ]);

    await migration(tree);

    const init = tree.read(INIT_PATH, 'utf-8')!;
    expect(init).toContain(
      'export type Context = IMiddlewareContext & IMyDbContext & IOtherDbContext;',
    );
    expect(init).toContain(`from './middleware/my-db.js'`);
    expect(init).toContain(`from './middleware/other-db.js'`);
  });

  it('should be idempotent', async () => {
    setupApi([{ name: 'my-db', pascal: 'MyDb', camel: 'myDb' }]);

    await migration(tree);
    const afterFirst = tree.read(INIT_PATH, 'utf-8');
    await migration(tree);

    expect(tree.read(INIT_PATH, 'utf-8')).toEqual(afterFirst);
    expect(afterFirst!.match(/IMyDbContext/g)).toHaveLength(2);
  });

  it('should preserve a user-widened context', async () => {
    setupApi(
      [{ name: 'my-db', pascal: 'MyDb', camel: 'myDb' }],
      PRE_FIX_INIT.replace(
        'export type Context = IMiddlewareContext;',
        `export interface IUserContext {
  userId: string;
}

export type Context = IMiddlewareContext & IUserContext;`,
      ),
    );

    await migration(tree);

    const init = tree.read(INIT_PATH, 'utf-8')!;
    expect(init).toContain('userId: string');
    expect(init).toContain(
      'export type Context = IMiddlewareContext & IUserContext & IMyDbContext;',
    );
  });

  it('should skip and report a context that has diverged from the generated shape', async () => {
    setupApi(
      [{ name: 'my-db', pascal: 'MyDb', camel: 'myDb' }],
      `import { initTRPC } from '@trpc/server';

export const t = initTRPC
  .context<{ event: unknown }>()
  .create();
`,
    );

    const result = await migration(tree);

    expect(tree.read(INIT_PATH, 'utf-8')).not.toContain('IMyDbContext');
    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps?.[0]).toContain('IMyDbContext');
  });

  it('should report a project with no init.ts', async () => {
    setupApi([{ name: 'my-db', pascal: 'MyDb', camel: 'myDb' }], null);

    const result = await migration(tree);

    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps?.[0]).toContain('no src/init.ts');
  });

  it('should leave projects without an rdb connection untouched', async () => {
    addProjectConfiguration(tree, 'api', {
      name: 'api',
      root: 'packages/api',
    });
    tree.write(INIT_PATH, PRE_FIX_INIT);

    const result = await migration(tree);

    expect(tree.read(INIT_PATH, 'utf-8')).toEqual(PRE_FIX_INIT);
    expect(result.nextSteps).toEqual([]);
  });
});
