/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { TS_AGENT_GENERATOR_INFO } from '../../../ts/agent/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const registerAgentProject = (
  tree: Tree,
  name: string,
  root: string,
  protocol: string,
  agentDir = 'src/agent',
) =>
  addProjectConfiguration(tree, name, {
    root,
    metadata: {
      components: [
        {
          generator: TS_AGENT_GENERATOR_INFO.id,
          path: agentDir,
          rc: 'MyAgent',
          protocol,
        },
      ],
    } as any,
  });

// Exact shape produced by biome's formatter on the previously-generated
// (pre-extraction) template, wrapped onto multiple lines.
const OLD_A2A_INDEX = `import { A2AExpressServer } from '@strands-agents/sdk/a2a/express';
import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import { randomUUID } from 'node:crypto';
import {
  runWithSessionId,
  withSessionId,
} from '@my-ts-agents/agent-connection';
import { getAgent } from './agent.js';

const PORT = parseInt(process.env.PORT || '9000');
const HOST = '0.0.0.0';

const SESSION_ID_HEADER = 'x-amzn-bedrock-agentcore-runtime-session-id';

void (async () => {
  const httpUrl =
    process.env.AGENTCORE_RUNTIME_URL ?? \`http://localhost:\${PORT}/\`;

  const server = new A2AExpressServer({
    agent: withSessionId(getAgent),
    name: 'A2a',
    description:
      'A Strands Agent exposed via the Agent-to-Agent (A2A) protocol.',
    host: HOST,
    port: PORT,
    httpUrl,
  });

  const app = express();
  app.get('/ping', (_req, res) => res.status(200).json({ status: 'Healthy' }));
  // Bind the inbound session (or a fresh UUID) for downstream MCP / A2A calls.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers[SESSION_ID_HEADER];
    const sessionId =
      (Array.isArray(header) ? header[0] : header) ?? randomUUID();
    runWithSessionId(sessionId, () => next());
  });
  app.use(server.createMiddleware());
  app.listen(PORT, HOST, () => {
    console.log(\`A2A server listening on \${HOST}:\${PORT}\`);
  });
})();
`;

const OLD_AGUI_INDEX = `import { StrandsAgent } from '@ag-ui/aws-strands';
import {
  addStrandsExpressEndpoint,
  addPing,
  addCapabilities,
} from '@ag-ui/aws-strands/server';
import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import {
  ModelErrorLoggingPlugin,
  ToolErrorLoggingPlugin,
  runWithSessionId,
} from '@my-ts-agents/agent-connection';
import { getAgent } from './agent.js';
import { getSessionManager } from './session.js';

const PORT = parseInt(process.env.PORT || '8080');
const HOST = '0.0.0.0';

const SESSION_ID_HEADER = 'x-amzn-bedrock-agentcore-runtime-session-id';

// Bind the inbound session (or a fresh UUID) for downstream MCP / A2A calls.
const sessionIdMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const header = req.headers[SESSION_ID_HEADER];
  const sessionId =
    (Array.isArray(header) ? header[0] : header) ?? randomUUID();
  runWithSessionId(sessionId, () => next());
};

void (async () => {
  const agent = await getAgent();

  // Connect MCP clients and register their tools so StrandsAgent can discover them.
  await agent.initialize();

  const aguiAgent = new StrandsAgent({
    agent,
    name: 'Agui',
    description: 'A Strands Agent exposed via the AG-UI protocol.',
    plugins: [new ModelErrorLoggingPlugin(), new ToolErrorLoggingPlugin()],
    config: {
      sessionManagerProvider: getSessionManager,
    },
  });

  // Built up manually (mirroring createStrandsApp's defaults) rather than via createStrandsApp
  // https://github.com/ag-ui-protocol/ag-ui/blob/main/integrations/aws-strands/typescript/src/server.ts
  const app = express();
  app.use(cors({ origin: '*', credentials: true }));
  app.use(express.json({ limit: '50mb' }));

  addPing(app, '/ping');
  addCapabilities(app, '/capabilities', { agent: aguiAgent });

  app.use(sessionIdMiddleware);

  addStrandsExpressEndpoint(app, aguiAgent, { path: '/invocations' });

  app.listen(PORT, HOST, () => {
    console.log(\`AG-UI server listening on \${HOST}:\${PORT}\`);
  });
})();
`;

describe('ts#agent session-id middleware extraction migration', () => {
  it('should extract A2A middleware into a shared module', async () => {
    const tree = createTreeUsingTsSolutionSetup();
    registerAgentProject(tree, 'agents', 'packages/agents', 'a2a', 'src/a2a');
    tree.write('packages/agents/src/a2a/index.ts', OLD_A2A_INDEX);

    const result = await migration(tree);

    expect(result.nextSteps).toEqual([]);

    const indexContent = tree.read('packages/agents/src/a2a/index.ts', 'utf-8');
    expect(indexContent).toContain(
      "import { sessionIdMiddleware } from './middleware/session-id-middleware.js';",
    );
    expect(indexContent).toContain("import express from 'express';");
    expect(indexContent).toContain('app.use(sessionIdMiddleware);');
    expect(indexContent).not.toContain('SESSION_ID_HEADER');
    expect(indexContent).not.toContain('randomUUID');
    expect(indexContent).not.toContain('runWithSessionId');
    expect(indexContent).toContain(
      "import { withSessionId } from '@my-ts-agents/agent-connection';",
    );

    const middlewareContent = tree.read(
      'packages/agents/src/a2a/middleware/session-id-middleware.ts',
      'utf-8',
    );
    expect(middlewareContent).toContain(
      "import { runWithSessionId } from '@my-ts-agents/agent-connection';",
    );
    expect(middlewareContent).toContain('export const sessionIdMiddleware');
  });

  it('should extract A2A middleware when the express import specifiers were reordered (e.g. alphabetized by the consumer repo formatter)', async () => {
    const tree = createTreeUsingTsSolutionSetup();
    registerAgentProject(tree, 'agents', 'packages/agents', 'a2a', 'src/a2a');
    const reordered = OLD_A2A_INDEX.replace(
      "import express, {\n  type Request,\n  type Response,\n  type NextFunction,\n} from 'express';",
      "import express, {\n  type NextFunction,\n  type Request,\n  type Response,\n} from 'express';",
    );
    tree.write('packages/agents/src/a2a/index.ts', reordered);

    const result = await migration(tree);

    expect(result.nextSteps).toEqual([]);

    const indexContent = tree.read('packages/agents/src/a2a/index.ts', 'utf-8');
    expect(indexContent).toContain("import express from 'express';");
    expect(indexContent).toContain('app.use(sessionIdMiddleware);');
    expect(
      tree.exists(
        'packages/agents/src/a2a/middleware/session-id-middleware.ts',
      ),
    ).toBe(true);
  });

  it('should extract AG-UI middleware into a shared module', async () => {
    const tree = createTreeUsingTsSolutionSetup();
    registerAgentProject(
      tree,
      'agents',
      'packages/agents',
      'ag-ui',
      'src/agui',
    );
    tree.write('packages/agents/src/agui/index.ts', OLD_AGUI_INDEX);

    const result = await migration(tree);

    expect(result.nextSteps).toEqual([]);

    const indexContent = tree.read(
      'packages/agents/src/agui/index.ts',
      'utf-8',
    );
    expect(indexContent).toContain(
      "import { sessionIdMiddleware } from './middleware/session-id-middleware.js';",
    );
    expect(indexContent).toContain("import express from 'express';");
    expect(indexContent).toContain('app.use(sessionIdMiddleware);');
    expect(indexContent).not.toContain('SESSION_ID_HEADER');
    expect(indexContent).not.toContain('randomUUID');
    expect(indexContent).not.toContain('runWithSessionId');
    expect(indexContent).toContain(
      "import {\n  ModelErrorLoggingPlugin,\n  ToolErrorLoggingPlugin,\n} from '@my-ts-agents/agent-connection';",
    );

    const middlewareContent = tree.read(
      'packages/agents/src/agui/middleware/session-id-middleware.ts',
      'utf-8',
    );
    expect(middlewareContent).toContain(
      "import { runWithSessionId } from '@my-ts-agents/agent-connection';",
    );
    expect(middlewareContent).toContain('export const sessionIdMiddleware');
  });

  it('should be idempotent when re-run on an already-migrated file', async () => {
    const tree = createTreeUsingTsSolutionSetup();
    registerAgentProject(tree, 'agents', 'packages/agents', 'a2a', 'src/a2a');
    tree.write('packages/agents/src/a2a/index.ts', OLD_A2A_INDEX);

    await migration(tree);
    const onceMigrated = tree.read('packages/agents/src/a2a/index.ts', 'utf-8');
    const onceMiddleware = tree.read(
      'packages/agents/src/a2a/middleware/session-id-middleware.ts',
      'utf-8',
    );

    const result = await migration(tree);

    expect(result.nextSteps).toEqual([]);
    expect(tree.read('packages/agents/src/a2a/index.ts', 'utf-8')).toEqual(
      onceMigrated,
    );
    expect(
      tree.read(
        'packages/agents/src/a2a/middleware/session-id-middleware.ts',
        'utf-8',
      ),
    ).toEqual(onceMiddleware);
  });

  it('should leave HTTP protocol agents untouched', async () => {
    const tree = createTreeUsingTsSolutionSetup();
    registerAgentProject(tree, 'agents', 'packages/agents', 'http', 'src/http');
    const httpIndex = `import { createServer } from 'http';\nexport const server = createServer();\n`;
    tree.write('packages/agents/src/http/index.ts', httpIndex);

    const result = await migration(tree);

    expect(result.nextSteps).toEqual([]);
    expect(tree.read('packages/agents/src/http/index.ts', 'utf-8')).toEqual(
      httpIndex,
    );
    expect(
      tree.exists(
        'packages/agents/src/http/middleware/session-id-middleware.ts',
      ),
    ).toBe(false);
  });

  it('should report divergence and leave a customised middleware body untouched', async () => {
    const tree = createTreeUsingTsSolutionSetup();
    registerAgentProject(tree, 'agents', 'packages/agents', 'a2a', 'src/a2a');
    const diverged = OLD_A2A_INDEX.replace(
      'runWithSessionId(sessionId, () => next());',
      "console.log('custom logging');\n    runWithSessionId(sessionId, () => next());",
    );
    tree.write('packages/agents/src/a2a/index.ts', diverged);

    const result = await migration(tree);

    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps[0]).toContain('packages/agents/src/a2a/index.ts');
    expect(result.nextSteps[0]).toContain('diverged');
    expect(tree.read('packages/agents/src/a2a/index.ts', 'utf-8')).toEqual(
      diverged,
    );
    expect(
      tree.exists(
        'packages/agents/src/a2a/middleware/session-id-middleware.ts',
      ),
    ).toBe(false);
  });
});
