/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

/** The shape the generator wrote before the fix. */
const VENDED_LOCAL_SERVER = `import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { appRouter } from './router.js';
import cors from 'cors';

const PORT = 2022;

createHTTPServer({
  router: appRouter,
  middleware: cors(),
  createContext() {
    return {
      event: {} as any,
      context: {} as any,
      info: {} as any,
    };
  },
}).listen(PORT);

console.log(\`Local TRPC server listening on port \${PORT}\`);
`;

describe('trpc-local-server-loopback-bind', () => {
  let tree: Tree;

  const addApi = (name: string, content?: string) => {
    addProjectConfiguration(tree, name, {
      root: `apps/${name}`,
      metadata: { generator: 'ts#trpc-api' } as never,
    });
    if (content !== undefined) {
      tree.write(`apps/${name}/src/local-server.ts`, content);
    }
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should bind the vended local server to loopback', async () => {
    addApi('test-api', VENDED_LOCAL_SERVER);

    const result = await migration(tree);

    const migrated = tree.read('apps/test-api/src/local-server.ts', 'utf-8');
    expect(migrated).toContain("const HOST = process.env.HOST || '127.0.0.1'");
    expect(migrated).toContain('.listen(PORT, HOST)');
    // The address is what changed, so the log line names it, which also
    // leaves a migrated file matching a freshly generated one.
    expect(migrated).toContain(
      'console.log(`Local TRPC server listening on ${HOST}:${PORT}`)',
    );
    expect(migrated).not.toContain('listening on port');
    expect(result.nextSteps).toEqual([]);
  });

  it('should leave a log line the user edited alone', async () => {
    const ownLogLine = VENDED_LOCAL_SERVER.replace(
      'console.log(`Local TRPC server listening on port ${PORT}`);',
      'console.log(`up on ${PORT}`);',
    );
    addApi('test-api', ownLogLine);

    await migration(tree);

    const migrated = tree.read('apps/test-api/src/local-server.ts', 'utf-8');
    // The bind address is still fixed; only the log rewrite matches nothing.
    expect(migrated).toContain('.listen(PORT, HOST)');
    expect(migrated).toContain('console.log(`up on ${PORT}`)');
  });

  it('should be idempotent', async () => {
    addApi('test-api', VENDED_LOCAL_SERVER);

    await migration(tree);
    const once = tree.read('apps/test-api/src/local-server.ts', 'utf-8');
    await migration(tree);

    expect(tree.read('apps/test-api/src/local-server.ts', 'utf-8')).toBe(once);
  });

  it('should leave a server that already names a host alone', async () => {
    const alreadyBound = VENDED_LOCAL_SERVER.replace(
      '}).listen(PORT);',
      "}).listen(PORT, process.env.HOST || '0.0.0.0');",
    );
    addApi('test-api', alreadyBound);

    const result = await migration(tree);

    expect(tree.read('apps/test-api/src/local-server.ts', 'utf-8')).toBe(
      alreadyBound,
    );
    expect(result.nextSteps).toEqual([]);
  });

  it('should report a local server it does not recognise', async () => {
    addApi('test-api', '// my own server\nstartMyServer();\n');

    const result = await migration(tree);

    expect(tree.read('apps/test-api/src/local-server.ts', 'utf-8')).toBe(
      '// my own server\nstartMyServer();\n',
    );
    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps?.[0]).toContain(
      'apps/test-api/src/local-server.ts',
    );
    // A file can fail the match because it already names a host deliberately,
    // so the message names both cases rather than telling every reader to
    // pass 127.0.0.1.
    expect(result.nextSteps?.[0]).toContain('already names a bind address');
    expect(result.nextSteps?.[0]).toContain('0.0.0.0');
  });

  it('should skip a project with no local server', async () => {
    addApi('ecs-api');

    const result = await migration(tree);

    expect(result.nextSteps).toEqual([]);
  });

  it('should skip a project this generator did not create', async () => {
    addProjectConfiguration(tree, 'other', {
      root: 'apps/other',
      metadata: { generator: 'ts#project' } as never,
    });
    tree.write('apps/other/src/local-server.ts', VENDED_LOCAL_SERVER);

    await migration(tree);

    expect(tree.read('apps/other/src/local-server.ts', 'utf-8')).toBe(
      VENDED_LOCAL_SERVER,
    );
  });
});
