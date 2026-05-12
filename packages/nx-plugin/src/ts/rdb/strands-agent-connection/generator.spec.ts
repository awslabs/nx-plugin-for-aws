/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree, readProjectConfiguration } from '@nx/devkit';
import { describe, it, expect, beforeEach } from 'vitest';
import { tsRdbStrandsAgentConnectionGenerator } from './generator';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';

describe('ts#rdb strands-agent-connection generator', () => {
  let tree: Tree;

  const setupRdbProject = (name = 'db') => {
    tree.write(
      `packages/${name}/project.json`,
      JSON.stringify({
        name,
        root: `packages/${name}`,
        targets: {
          'serve-local': { executor: 'nx:run-commands', continuous: true },
        },
      }),
    );
  };

  const setupAgentProject = (
    name = 'my-service',
    agentName = 'my-agent',
    protocol = 'HTTP',
  ) => {
    tree.write(
      `packages/${name}/project.json`,
      JSON.stringify({
        name,
        root: `packages/${name}`,
        targets: {
          [`${agentName}-serve-local`]: {
            executor: 'nx:run-commands',
            continuous: true,
          },
        },
        metadata: {
          components: [
            {
              generator: 'ts#strands-agent',
              name: agentName,
              path: `src/${agentName}`,
              protocol,
            },
          ],
        },
      }),
    );

    if (protocol === 'A2A') {
      tree.write(
        `packages/${name}/src/${agentName}/agent.ts`,
        `import { Agent, tool } from '@strands-agents/sdk';
import { z } from 'zod';

const multiply = tool({
  name: 'Multiply',
  description: 'Multiply two numbers',
  inputSchema: z.object({ a: z.number(), b: z.number() }),
  callback: ({ a, b }) => a * b,
});

export const getAgent = async (sessionId: string) => {
  return new Agent({
    systemPrompt: 'You are a helpful assistant.',
    tools: [multiply],
  });
};
`,
      );
      tree.write(
        `packages/${name}/src/${agentName}/index.ts`,
        `import { A2AExpressServer } from '@strands-agents/sdk/a2a/express';
import express from 'express';
import { getAgent } from './agent.js';

const PORT = parseInt(process.env.PORT || '9000');
const HOST = '0.0.0.0';

void (async () => {
  const server = new A2AExpressServer({
    agent: await getAgent('default'),
    name: 'MyAgent',
    host: HOST,
    port: PORT,
  });

  const app = express();
  app.use(server.createMiddleware());
  app.listen(PORT, HOST);
})();
`,
      );
      return;
    }

    tree.write(
      `packages/${name}/src/${agentName}/agent.ts`,
      `import { Agent, tool } from '@strands-agents/sdk';
import { z } from 'zod';

const multiply = tool({
  name: 'Multiply',
  description: 'Multiply two numbers',
  inputSchema: z.object({ a: z.number(), b: z.number() }),
  callback: ({ a, b }) => a * b,
});

export const getAgent = async (sessionId: string) => {
  return new Agent({
    systemPrompt: 'You are a helpful assistant.',
    tools: [multiply],
  });
};
`,
    );
    tree.write(
      `packages/${name}/src/${agentName}/init.ts`,
      `import { initTRPC } from '@trpc/server';

export interface Context {
  sessionId: string;
}

export const t = initTRPC.context<Context>().create();

export const publicProcedure = t.procedure;
`,
    );
    tree.write(
      `packages/${name}/src/${agentName}/router.ts`,
      `import { publicProcedure, t } from './init.js';
import { z } from 'zod';
import { getAgent } from './agent.js';

export const router = t.router;

export const appRouter = router({
  invoke: publicProcedure
    .input(z.object({ message: z.string() }))
    .subscription(async function* (opts) {
      const agent = await getAgent(opts.ctx.sessionId);
      for await (const event of agent.stream(opts.input.message)) {
        yield event;
      }
      return;
    }),
});

export type AppRouter = typeof appRouter;
`,
    );
    tree.write(
      `packages/${name}/src/${agentName}/index.ts`,
      `import { randomUUID } from 'node:crypto';
import { createServer } from 'http';
import {
  CreateHTTPContextOptions,
  createHTTPHandler,
} from '@trpc/server/adapters/standalone';
import { appRouter, AppRouter } from './router.js';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import {
  CreateWSSContextFnOptions,
  applyWSSHandler,
} from '@trpc/server/adapters/ws';
import { Context } from './init.js';

const PORT = parseInt(process.env.PORT || '8080');

const createContext = (
  opts: CreateHTTPContextOptions | CreateWSSContextFnOptions,
): Context => {
  const sessionId =
    ('req' in opts
      ? opts.req.headers['x-session-id']
      : undefined) ?? randomUUID();
  return {
    sessionId: Array.isArray(sessionId) ? sessionId[0] : sessionId,
  };
};

const handler = createHTTPHandler({
  router: appRouter,
  middleware: cors(),
  createContext,
});

const server = createServer((req, res) => {
  handler(req, res);
});

server.listen(PORT);
`,
    );
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should add rdb serve-local dependency to the agent prefixed serve-local', async () => {
    setupAgentProject('my-service', 'my-agent');
    setupRdbProject();

    await tsRdbStrandsAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#strands-agent', name: 'my-agent' },
    });

    expect(readProjectConfiguration(tree, 'my-service')).toMatchSnapshot();
  });

  it('should inject into init.ts, index.ts, router.ts and agent.ts', async () => {
    setupAgentProject('my-service', 'my-agent');
    setupRdbProject();

    await tsRdbStrandsAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#strands-agent', name: 'my-agent' },
    });

    expect(
      tree.read('packages/my-service/src/my-agent/init.ts', 'utf-8'),
    ).toMatchSnapshot();
    expect(
      tree.read('packages/my-service/src/my-agent/index.ts', 'utf-8'),
    ).toMatchSnapshot();
    expect(
      tree.read('packages/my-service/src/my-agent/router.ts', 'utf-8'),
    ).toMatchSnapshot();
    expect(
      tree.read('packages/my-service/src/my-agent/agent.ts', 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should be idempotent across init.ts, index.ts, router.ts and agent.ts', async () => {
    setupAgentProject('my-service', 'my-agent');
    setupRdbProject();

    await tsRdbStrandsAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#strands-agent', name: 'my-agent' },
    });
    await tsRdbStrandsAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#strands-agent', name: 'my-agent' },
    });

    expect(
      tree.read('packages/my-service/src/my-agent/init.ts', 'utf-8'),
    ).toMatchSnapshot();
    expect(
      tree.read('packages/my-service/src/my-agent/index.ts', 'utf-8'),
    ).toMatchSnapshot();
    expect(
      tree.read('packages/my-service/src/my-agent/router.ts', 'utf-8'),
    ).toMatchSnapshot();
    expect(
      tree.read('packages/my-service/src/my-agent/agent.ts', 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should support multiple rdb connections in router.ts', async () => {
    setupAgentProject('my-service', 'my-agent');
    setupRdbProject('postgres-db');
    setupRdbProject('mysql-db');

    await tsRdbStrandsAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'postgres-db',
      sourceComponent: { generator: 'ts#strands-agent', name: 'my-agent' },
    });
    await tsRdbStrandsAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'mysql-db',
      sourceComponent: { generator: 'ts#strands-agent', name: 'my-agent' },
    });

    expect(
      tree.read('packages/my-service/src/my-agent/router.ts', 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should fall back to agent-serve-local when no component name', async () => {
    setupAgentProject('my-service', 'agent');
    setupRdbProject();

    await tsRdbStrandsAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#strands-agent' },
    });

    expect(readProjectConfiguration(tree, 'my-service')).toMatchSnapshot();
  });

  it('should inject db into A2A index.ts', async () => {
    setupAgentProject('my-service', 'my-agent', 'A2A');
    setupRdbProject();

    await tsRdbStrandsAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#strands-agent', name: 'my-agent' },
    });

    expect(
      tree.read('packages/my-service/src/my-agent/index.ts', 'utf-8'),
    ).toMatchSnapshot();
    expect(
      tree.read('packages/my-service/src/my-agent/agent.ts', 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should be idempotent for A2A index.ts and agent.ts injection', async () => {
    setupAgentProject('my-service', 'my-agent', 'A2A');
    setupRdbProject();

    await tsRdbStrandsAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#strands-agent', name: 'my-agent' },
    });
    await tsRdbStrandsAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#strands-agent', name: 'my-agent' },
    });

    expect(
      tree.read('packages/my-service/src/my-agent/index.ts', 'utf-8'),
    ).toMatchSnapshot();
    expect(
      tree.read('packages/my-service/src/my-agent/agent.ts', 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should not add dependency when agent serve-local target does not exist', async () => {
    tree.write(
      `packages/my-service/project.json`,
      JSON.stringify({
        name: 'my-service',
        root: 'packages/my-service',
        targets: {},
      }),
    );
    setupRdbProject();

    await tsRdbStrandsAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#strands-agent', name: 'my-agent' },
    });

    const config = readProjectConfiguration(tree, 'my-service');
    expect(config.targets?.['my-agent-serve-local']).toBeUndefined();
  });

  it('should be idempotent for serve-local wiring', async () => {
    setupAgentProject('my-service', 'my-agent');
    setupRdbProject();

    await tsRdbStrandsAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#strands-agent', name: 'my-agent' },
    });
    await tsRdbStrandsAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#strands-agent', name: 'my-agent' },
    });

    const config = readProjectConfiguration(tree, 'my-service');
    const deps = (
      config.targets?.['my-agent-serve-local']?.dependsOn ?? []
    ).filter(
      (d: any) =>
        typeof d === 'object' &&
        d.projects?.includes('db') &&
        d.target === 'serve-local',
    );
    expect(deps).toHaveLength(1);
  });
});
