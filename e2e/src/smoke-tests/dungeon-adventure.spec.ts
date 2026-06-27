/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type ChildProcess, execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { getPackageManagerCommand } from '@nx/devkit';
import { ensureDirSync } from 'fs-extra';
import type { MockServer } from 'llm-mock-server';
import {
  buildPackageManagerShortCommand,
  createTestWorkspace,
  getDungeonAdventureElectroDbDependencies,
  runCLI,
  tmpProjPath,
} from '../utils';
import { startLlmMock } from '../utils/llm-mock';

const LLM_MOCK_PORT = 19824;
const STARTUP_TIMEOUT_MS = 120_000;
const HEALTH_CHECK_INTERVAL_MS = 2_000;

const isUpdateSnapshot = () =>
  (globalThis as any).__vitest_worker__?.config?.snapshotOptions
    ?.updateSnapshot === 'all';

/**
 * Asserts that the generated file matches the expected "old" template.
 * When vitest is run with `-u`, the old template is overwritten with the
 * actual generated content so the templates stay up-to-date automatically.
 */
const expectFileMatchesOldTemplate = (
  generatedFilePath: string,
  oldTemplatePath: string,
) => {
  const actual = readFileSync(generatedFilePath, 'utf-8');
  if (isUpdateSnapshot()) {
    const existing = readFileSync(oldTemplatePath, 'utf-8');
    if (actual !== existing) {
      console.log(`Updating template: ${oldTemplatePath}`);
      writeFileSync(oldTemplatePath, actual);
    }
  } else {
    expect(actual).toEqual(readFileSync(oldTemplatePath, 'utf-8'));
  }
};

const dungeonFile = (...segments: string[]) =>
  join(__dirname, '../files/dungeon-adventure', ...segments);

const writeFromTemplate = (
  destination: string,
  ...templateSegments: string[]
) =>
  writeFileSync(
    destination,
    readFileSync(dungeonFile(...templateSegments), 'utf-8'),
  );

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      if (Date.now() > deadline) {
        reject(new Error(`Port ${port} not ready within ${timeoutMs}ms`));
        return;
      }
      const socket = createConnection({ port, host: '127.0.0.1' }, () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        setTimeout(attempt, HEALTH_CHECK_INTERVAL_MS);
      });
    };
    attempt();
  });
}

// Poll a URL until the JSON response satisfies `predicate`. Used to wait out
// the gap between DynamoDB Local's port opening and the local table being
// created (the dev cascade does both, but not atomically).
async function waitForJson(
  url: string,
  predicate: (body: any) => boolean,
  timeoutMs = STARTUP_TIMEOUT_MS,
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let last: any;
  for (;;) {
    try {
      last = await fetch(url).then((r) => r.json());
      if (predicate(last)) return last;
    } catch (e) {
      last = e;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for ${url}: ${JSON.stringify(last)?.slice(0, 500)}`,
      );
    }
    await new Promise((resolve) =>
      setTimeout(resolve, HEALTH_CHECK_INTERVAL_MS),
    );
  }
}

function startServer(
  cwd: string,
  target: string,
  env?: Record<string, string>,
): ChildProcess {
  const child = spawn('pnpm', ['exec', 'nx', 'run', target], {
    cwd,
    detached: true,
    env: { ...process.env, NX_DAEMON: 'true', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d: Buffer) =>
    process.stdout.write(`[${target}] ${d}`),
  );
  child.stderr?.on('data', (d: Buffer) =>
    process.stderr.write(`[${target}] ${d}`),
  );
  return child;
}

function killProcess(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (!child.pid) {
      resolve();
      return;
    }
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // already dead
    }
    const timeout = setTimeout(() => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        // already dead
      }
      resolve();
    }, 5000);
    child.on('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function getPortFromProjectJson(
  projectRoot: string,
  relPath: string,
  targetName: string,
): number {
  const fullPath = `${projectRoot}/${relPath}`;
  const pj = JSON.parse(readFileSync(fullPath, 'utf-8'));
  const target = pj.targets?.[targetName];
  if (!target)
    throw new Error(`Target "${targetName}" not found in ${relPath}`);

  const envPort = target.options?.env?.PORT;
  if (envPort) return Number(envPort);

  const cmd: string =
    target.options?.command ?? target.options?.commands?.[0] ?? '';
  const m = cmd.match(/--port\s+(\d+)/);
  if (m) return Number(m[1]);

  const ports = pj.metadata?.ports;
  if (Array.isArray(ports) && ports.length > 0) return Number(ports[0]);

  throw new Error(`Cannot determine port for "${targetName}" in ${relPath}`);
}

/**
 * This test runs through the dungeon adventure tutorial from the docs
 */
describe('smoke test - dungeon-adventure', () => {
  const pkgMgr = 'pnpm';
  const targetDir = `${tmpProjPath()}/dungeon-adventure-${pkgMgr}`;
  const projectRoot = `${targetDir}/dungeon-adventure`;
  const opts = { cwd: projectRoot, env: { NX_DAEMON: 'false' } };
  const runningProcesses: ChildProcess[] = [];
  let llmMock: MockServer | undefined;

  // DynamoDB Local persists to a named volume keyed on the workspace scope, so
  // remove the container and its volume between runs to guarantee a fresh table
  // (otherwise a previous run's data leaks into this one's assertions).
  const cleanupDynamoLocal = () => {
    for (const cmd of [
      'docker rm -f dungeon-adventure-dynamodb',
      'docker volume rm dungeon-adventure-dynamodb-data',
    ]) {
      try {
        execSync(cmd, { stdio: 'ignore' });
      } catch {
        // not present
      }
    }
  };

  beforeEach(() => {
    console.log(`Cleaning target directory ${targetDir}`);
    if (existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
    ensureDirSync(targetDir);
    cleanupDynamoLocal();
  });

  afterEach(async () => {
    await Promise.all(runningProcesses.map(killProcess));
    runningProcesses.length = 0;
    if (llmMock) {
      await llmMock.stop();
      llmMock = undefined;
    }
    cleanupDynamoLocal();
  });

  async function startAndWait(
    target: string,
    port: number,
    env?: Record<string, string>,
  ) {
    const child = startServer(projectRoot, target, env);
    runningProcesses.push(child);
    await waitForPort(port, STARTUP_TIMEOUT_MS);
    return child;
  }

  async function stopAll() {
    await Promise.all(runningProcesses.map(killProcess));
    runningProcesses.length = 0;
  }

  it('should generate and build', async () => {
    // 1. Monorepo Setup

    await createTestWorkspace(pkgMgr, targetDir, 'dungeon-adventure', 'cdk');

    await runCLI(
      `generate @aws/nx-plugin:ts#api --name=GameApi --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:py#project --name=story --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:py#agent --project=story --auth=cognito --protocol=ag-ui --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:ts#project --name=inventory --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:ts#mcp-server --project=inventory --no-interactive`,
      opts,
    );
    // The DynamoDB table backing the game's state, with local development
    // support via DynamoDB Local
    await runCLI(
      `generate @aws/nx-plugin:ts#dynamodb --name=DungeonDb --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:ts#website --name=GameUI --ux=shadcn --no-interactive`,
      opts,
    );
    // No need to allow signup for the e2e tests
    await runCLI(
      `generate @aws/nx-plugin:ts#website#auth --cognitoDomain=game-ui --project=@dungeon-adventure/game-ui --no-interactive --allowSignup=false`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:connection --sourceProject=@dungeon-adventure/game-ui --targetProject=@dungeon-adventure/game-api --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:connection --sourceProject=story --targetProject=inventory --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:connection --sourceProject=@dungeon-adventure/game-ui --targetProject=story --no-interactive`,
      opts,
    );
    // Wire the Game API and the Inventory MCP server to the DynamoDB table so
    // their dev targets boot DynamoDB Local automatically
    await runCLI(
      `generate @aws/nx-plugin:connection --sourceProject=@dungeon-adventure/game-api --targetProject=@dungeon-adventure/dungeon-db --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:connection --sourceProject=@dungeon-adventure/inventory --targetProject=@dungeon-adventure/dungeon-db --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:ts#infra --name=infra --no-interactive`,
      opts,
    );

    // Check application stack matches application-stack.ts.original.template
    const applicationStackPath = `${opts.cwd}/packages/infra/src/stacks/application-stack.ts`;
    expectFileMatchesOldTemplate(
      applicationStackPath,
      dungeonFile('1/application-stack.ts.original.template'),
    );

    writeFromTemplate(applicationStackPath, '1/application-stack.ts.template');
    await runCLI(`sync --verbose`, opts);
    await runCLI(
      `${buildPackageManagerShortCommand(pkgMgr, 'build')} --output-style=stream --skip-nx-cache --verbose`,
      { ...opts, prefixWithPackageManagerCmd: false },
    );

    // 2. Game API and Inventory MCP Server

    await runCLI(
      `${getPackageManagerCommand(pkgMgr).add} ${getDungeonAdventureElectroDbDependencies()}`,
      {
        ...opts,
        prefixWithPackageManagerCmd: false,
        retry: true,
      },
    );

    // Model the Game and Inventory entities in the DynamoDB project
    writeFromTemplate(
      `${opts.cwd}/packages/dungeon-db/src/entities/index.ts`,
      '2/dungeon-db/entities/index.ts.template',
    );
    rmSync(`${opts.cwd}/packages/dungeon-db/src/entities/example.ts`);

    // Game API schema
    ensureDirSync(`${opts.cwd}/packages/game-api/src/schema`);
    writeFromTemplate(
      `${opts.cwd}/packages/game-api/src/schema/index.ts`,
      '2/schema/index.ts.template',
    );

    writeFromTemplate(
      `${opts.cwd}/packages/game-api/src/procedures/actions.ts`,
      '2/procedures/actions.ts.template',
    );
    writeFromTemplate(
      `${opts.cwd}/packages/game-api/src/procedures/games.ts`,
      '2/procedures/games.ts.template',
    );
    writeFromTemplate(
      `${opts.cwd}/packages/game-api/src/procedures/inventory.ts`,
      '2/procedures/inventory.ts.template',
    );
    rmSync(`${opts.cwd}/packages/game-api/src/procedures/echo.ts`);

    // Check router.ts matches router.ts.old.template before modification
    const routerPath = `${opts.cwd}/packages/game-api/src/router.ts`;
    expectFileMatchesOldTemplate(
      routerPath,
      dungeonFile('2/router.ts.old.template'),
    );
    writeFromTemplate(routerPath, '2/router.ts.template');

    // Check mcp server.ts matches server.ts.old.template before modification
    const mcpServerPath = `${opts.cwd}/packages/inventory/src/mcp-server/server.ts`;
    expectFileMatchesOldTemplate(
      mcpServerPath,
      dungeonFile('2/mcp/server.ts.old.template'),
    );
    writeFromTemplate(mcpServerPath, '2/mcp/server.ts.template');

    rmSync(`${opts.cwd}/packages/inventory/src/mcp-server/tools`, {
      recursive: true,
      force: true,
    });
    rmSync(`${opts.cwd}/packages/inventory/src/mcp-server/resources`, {
      recursive: true,
      force: true,
    });

    writeFromTemplate(
      `${opts.cwd}/packages/infra/src/stacks/application-stack.ts`,
      '2/stacks/application-stack.ts.template',
    );

    await runCLI(`sync --verbose`, opts);
    await runCLI(`${buildPackageManagerShortCommand(pkgMgr, 'lint')}`, {
      ...opts,
      prefixWithPackageManagerCmd: false,
    });
    await runCLI(
      `${buildPackageManagerShortCommand(pkgMgr, 'build')} --output-style=stream --verbose`,
      { ...opts, prefixWithPackageManagerCmd: false },
    );

    // Module 3: Story Agent

    // Check main.py matches main.py.old.template before modification
    const mainPyPath = `${opts.cwd}/packages/story/dungeon_adventure_story/agent/main.py`;
    expectFileMatchesOldTemplate(
      mainPyPath,
      dungeonFile('3/main.py.old.template'),
    );
    writeFromTemplate(mainPyPath, '3/main.py.template');

    // Check agent.py matches agent.py.old.template before modification
    const agentPyPath = `${opts.cwd}/packages/story/dungeon_adventure_story/agent/agent.py`;
    expectFileMatchesOldTemplate(
      agentPyPath,
      dungeonFile('3/agent.py.old.template'),
    );
    writeFromTemplate(agentPyPath, '3/agent.py.template');

    await runCLI(`sync --verbose`, opts);
    await runCLI(`${buildPackageManagerShortCommand(pkgMgr, 'lint')}`, {
      ...opts,
      prefixWithPackageManagerCmd: false,
    });
    await runCLI(
      `${buildPackageManagerShortCommand(pkgMgr, 'build')} --output-style=stream --verbose`,
      { ...opts, prefixWithPackageManagerCmd: false },
    );

    // Module 4: UI

    // Single global styles file — dungeon theme + CopilotKit colour reset
    writeFromTemplate(
      `${opts.cwd}/packages/game-ui/src/styles.css`,
      '4/styles.css.template',
    );

    // Game route: CopilotChat for the AG-UI agent with deterministic threadId
    ensureDirSync(`${opts.cwd}/packages/game-ui/src/routes/game`);
    writeFromTemplate(
      `${opts.cwd}/packages/game-ui/src/routes/game/$playerName.tsx`,
      '4/routes/game/$playerName.tsx.template',
    );

    // Root route: new-game picker + continue list
    const routesIndexPath = `${opts.cwd}/packages/game-ui/src/routes/index.tsx`;
    expectFileMatchesOldTemplate(
      routesIndexPath,
      dungeonFile('4/routes/index.tsx.old.template'),
    );
    writeFromTemplate(routesIndexPath, '4/routes/index.tsx.template');

    await runCLI(`sync --verbose`, opts);
    await runCLI(`${buildPackageManagerShortCommand(pkgMgr, 'lint')}`, {
      ...opts,
      prefixWithPackageManagerCmd: false,
    });
    await runCLI(
      `${buildPackageManagerShortCommand(pkgMgr, 'build')} --output-style=stream --verbose`,
      { ...opts, prefixWithPackageManagerCmd: false },
    );

    // 5. Local end-to-end validation against DynamoDB Local
    //
    // Every component runs fully offline: the dev target boots DynamoDB Local via
    // the connection generators, and the Story Agent's LLM is pointed at a mock
    // OpenAI server (same strategy as the local-dev smoke test).
    //
    // This part drives long-lived dev servers via detached process groups and
    // POSIX signals, so it only runs on non-Windows (matching the local-dev
    // smoke test, which is Linux-only). On Windows we stop after verifying
    // generation and build above.
    if (process.platform === 'win32') {
      return;
    }

    // Point the Story Agent at the mock LLM
    llmMock = await startLlmMock(LLM_MOCK_PORT);
    const agentFile = `${opts.cwd}/packages/story/dungeon_adventure_story/agent/agent.py`;
    let agentContent = readFileSync(agentFile, 'utf-8');
    agentContent = `from strands.models.openai import OpenAIModel\n${agentContent}`;
    agentContent = agentContent.replace(
      /Agent\(\s*\n/,
      `Agent(\n            model=OpenAIModel(model_id="mock", client_args={"api_key": "test", "base_url": "http://127.0.0.1:${LLM_MOCK_PORT}/v1"}),\n`,
    );
    writeFileSync(agentFile, agentContent);
    await runCLI(`run dungeon_adventure.story:add -- openai`, opts);

    const gameApiPort = getPortFromProjectJson(
      projectRoot,
      'packages/game-api/project.json',
      'dev',
    );
    const mcpPort = getPortFromProjectJson(
      projectRoot,
      'packages/inventory/project.json',
      'mcp-server-dev',
    );
    const agentPort = getPortFromProjectJson(
      projectRoot,
      'packages/story/project.json',
      'agent-dev',
    );
    const dynamoPort = getPortFromProjectJson(
      projectRoot,
      'packages/dungeon-db/project.json',
      'dev',
    );

    // Bring the whole stack up with the one command the tutorial documents:
    // game-ui:dev cascades through the Game API, the Story Agent (which
    // boots the Inventory MCP server) and DynamoDB Local.
    const UI_PORT = 4200;
    await startAndWait('@dungeon-adventure/game-ui:dev', UI_PORT);
    await waitForPort(dynamoPort, STARTUP_TIMEOUT_MS);
    await waitForPort(gameApiPort, STARTUP_TIMEOUT_MS);
    await waitForPort(mcpPort, STARTUP_TIMEOUT_MS);
    await waitForPort(agentPort, STARTUP_TIMEOUT_MS);

    // Website dev server serves HTML
    const uiRes = await fetch(`http://127.0.0.1:${UI_PORT}/`);
    const uiHtml = await uiRes.text();
    console.log(`game-ui (${uiRes.status}, ${uiHtml.length} bytes)`);
    expect(uiRes.status).toBe(200);
    expect(uiHtml).toContain('<');

    // Game API procedures against DynamoDB Local. Poll the first read until the
    // local table has finished being created by the dev cascade.
    const emptyGames: any = await waitForJson(
      `http://127.0.0.1:${gameApiPort}/games.query?input=${encodeURIComponent('{}')}`,
      (b) => Array.isArray(b?.result?.data?.items),
    );
    console.log('games.query (empty):', JSON.stringify(emptyGames));
    expect(emptyGames.result.data.items).toEqual([]);

    const saved: any = await fetch(
      `http://127.0.0.1:${gameApiPort}/games.save`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName: 'Alice', genre: 'zombie' }),
      },
    ).then((r) => r.json());
    console.log('games.save:', JSON.stringify(saved));
    expect(saved.result.data.playerName).toBe('Alice');

    const games: any = await fetch(
      `http://127.0.0.1:${gameApiPort}/games.query?input=${encodeURIComponent('{}')}`,
    ).then((r) => r.json());
    console.log('games.query (after save):', JSON.stringify(games));
    expect(games.result.data.items).toHaveLength(1);
    expect(games.result.data.items[0].playerName).toBe('Alice');

    // Inventory MCP server initialize handshake
    const mcpRes = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1,
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      }),
    });
    console.log('Inventory MCP initialize:', mcpRes.status);
    expect(mcpRes.status).toBe(200);

    // Story Agent AG-UI invocation (uses the mock LLM + the Inventory MCP server)
    const agentRes = await fetch(`http://127.0.0.1:${agentPort}/invocations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadId: 'Alice-zombie00000000000000000000000',
        runId: 'run-1',
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'My name is Alice. Start my zombie adventure.',
          },
        ],
        tools: [],
        context: [],
        state: {},
        forwardedProps: {},
      }),
    });
    const agentBody = await agentRes.text();
    console.log(
      `Story Agent AG-UI (${agentRes.status}, ${agentBody.length} bytes):`,
      agentBody.slice(0, 200),
    );
    expect(agentRes.status).toBe(200);
    expect(agentBody).toContain('data:');
    await stopAll();
  });
});
