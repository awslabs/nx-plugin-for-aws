/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { stripVTControlCharacters } from 'node:util';
import { type ChildProcess, execSync, spawn } from 'child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { ensureDirSync } from 'fs-extra';
import type { MockServer } from 'llm-mock-server';
import { createConnection } from 'net';
import * as pty from 'node-pty';
import { createTestWorkspace, runCLI, tmpProjPath } from '../utils';
import { startLlmMock } from '../utils/llm-mock';

const STARTUP_TIMEOUT_MS = 120_000;
const HEALTH_CHECK_INTERVAL_MS = 2_000;
const LLM_MOCK_PORT = 19823;

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
// created (the serve-local cascade does both, but not atomically).
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

/**
 * Drive `agent-chat` through a PTY (the Clack prompt needs a TTY), send one
 * message once connected, and resolve when the agent streams `expected` back.
 * Proves the standalone chat boots, connects, submits input and renders the
 * reply end-to-end. Rejects if not seen before the timeout.
 */
function chatStreamsReply(
  cwd: string,
  target: string,
  expected: string,
  timeoutMs: number,
  message = 'What is 3 times 5?',
): Promise<void> {
  return new Promise((resolve, reject) => {
    const term = pty.spawn('pnpm', ['exec', 'nx', 'run', target], {
      cwd,
      env: { ...process.env, NX_DAEMON: 'true', RUNTIME_CONFIG_APP_ID: '' },
    });
    let out = '';
    let sent = false;
    let settled = false;
    const clean = () => stripVTControlCharacters(out);
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        term.kill();
      } catch {
        // already dead
      }
      err ? reject(err) : resolve();
    };
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            `Chat target ${target} did not stream "${expected}" within ${timeoutMs}ms. Output:\n${clean()}`,
          ),
        ),
      timeoutMs,
    );
    term.onData((d) => {
      out += d;
      process.stdout.write(`[${target}] ${d}`);
      const text = clean();
      if (!sent && text.includes('Connected to ')) {
        sent = true;
        setTimeout(() => term.write(`${message}\r`), 1000);
      }
      if (
        sent &&
        text.slice(text.indexOf(message) + message.length).includes(expected)
      ) {
        finish();
      }
    });
    term.onExit(() => finish(new Error(`Chat target ${target} exited early`)));
  });
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

describe('smoke test - serve-local', { timeout: 20 * 60 * 1000 }, () => {
  const pkgMgr = 'pnpm';
  const targetDir = `${tmpProjPath()}/serve-local-${pkgMgr}`;
  const runningProcesses: ChildProcess[] = [];
  let llmMock: MockServer | undefined;
  let projectRoot: string;
  let ports: Record<string, number>;

  // DynamoDB Local persists to a named volume keyed on the workspace scope, so
  // remove the container and its volume to guarantee a fresh table (otherwise a
  // previous run's data leaks into this run's assertions).
  const cleanupDynamoLocal = () => {
    for (const cmd of [
      `docker rm -f serve-local-test-dynamodb`,
      `docker volume rm serve-local-test-dynamodb-data`,
    ]) {
      try {
        execSync(cmd, { stdio: 'ignore' });
      } catch {
        // not present
      }
    }
  };

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

  async function stopLast() {
    const child = runningProcesses.pop();
    if (child) await killProcess(child);
  }

  beforeAll(
    async () => {
      // Start LLM mock
      llmMock = await startLlmMock(LLM_MOCK_PORT);
      console.log(`LLM mock started on port ${LLM_MOCK_PORT}`);

      // Clean and create workspace
      if (existsSync(targetDir))
        rmSync(targetDir, { force: true, recursive: true });
      ensureDirSync(targetDir);
      cleanupDynamoLocal();

      projectRoot = await createTestWorkspace(
        pkgMgr,
        targetDir,
        'serve-local-test',
        'cdk',
      );
      const opts = {
        cwd: projectRoot,
        env: { NX_DAEMON: 'false', NODE_OPTIONS: '--max-old-space-size=8192' },
      };

      // Generate all projects
      await runCLI(
        `generate @aws/nx-plugin:ts#api --name=my-api --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:py#api --name=py-api --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:ts#api --framework=smithy --name=my-smithy-api --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:ts#website --name=website --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:ts#project --name=ts-project --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:ts#agent --project=ts-project --name=my-agent --infra=none --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:ts#agent --project=ts-project --name=my-a2a-agent --protocol=a2a --infra=none --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:ts#agent --project=ts-project --name=my-agui-agent --protocol=ag-ui --infra=none --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:ts#mcp-server --project=ts-project --name=my-mcp --infra=none --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:py#project --name=py-project --projectType=application --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:py#agent --project=py_project --name=my-py-agent --infra=none --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:py#agent --project=py_project --name=my-py-a2a-agent --protocol=a2a --infra=none --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:py#agent --project=py_project --name=my-py-agui-agent --protocol=ag-ui --infra=none --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:py#mcp-server --project=py_project --name=my-py-mcp --infra=none --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:ts#rdb --name=postgres-db --infra=aurora --engine=postgres --framework=prisma --no-interactive`,
        opts,
      );
      // Python DynamoDB table, connected to the FastAPI so its serve-local
      // boots DynamoDB Local and the PynamoDB client points at it locally.
      await runCLI(
        `generate @aws/nx-plugin:py#dynamodb --name=py-table --no-interactive`,
        opts,
      );
      // AgentCore Gateway: a dedicated agent fronted only by the gateway,
      // which aggregates the same TS and Python MCP servers used by the
      // direct-connection tests above (Nx dedupes the shared continuous
      // serve-local targets within a single task graph).
      await runCLI(
        `generate @aws/nx-plugin:ts#agent --project=ts-project --name=gw-agent --infra=none --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:py#agent --project=py_project --name=gw-py-agent --infra=none --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:agentcore-gateway --name=my-gateway --no-interactive`,
        opts,
      );
      // A second gateway fronting my-gateway, to exercise the
      // gateway -> gateway connection (chained local gateways).
      await runCLI(
        `generate @aws/nx-plugin:agentcore-gateway --name=parent-gateway --no-interactive`,
        opts,
      );

      // Connections
      await runCLI(
        `generate @aws/nx-plugin:connection --sourceProject=website --targetProject=my-api --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:connection --sourceProject=website --targetProject=py_api --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:connection --sourceProject=website --targetProject=my-smithy-api --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:connection --sourceProject=my-api --targetProject=postgres-db --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:connection --sourceProject=py_api --targetProject=py_table --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:connection --sourceProject=ts-project --sourceComponent=my-agent --targetProject=ts-project --targetComponent=my-mcp --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:connection --sourceProject=py_project --sourceComponent=my-py-agent --targetProject=py_project --targetComponent=my-py-mcp --no-interactive`,
        opts,
      );
      // Gateway wiring: {gw-agent, gw-py-agent} -> gateway -> {my-mcp,
      // my-py-mcp}. Each agent's serve-local boots the local gateway, which
      // aggregates both MCP servers behind one endpoint.
      await runCLI(
        `generate @aws/nx-plugin:connection --sourceProject=ts-project --sourceComponent=gw-agent --targetProject=my-gateway --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:connection --sourceProject=py_project --sourceComponent=gw-py-agent --targetProject=my-gateway --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:connection --sourceProject=my-gateway --targetProject=ts-project --targetComponent=my-mcp --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:connection --sourceProject=my-gateway --targetProject=py_project --targetComponent=my-py-mcp --no-interactive`,
        opts,
      );
      // parent-gateway -> my-gateway: the parent's local gateway aggregates
      // my-gateway's (already prefixed) tools under a second prefix.
      await runCLI(
        `generate @aws/nx-plugin:connection --sourceProject=parent-gateway --targetProject=my-gateway --no-interactive`,
        opts,
      );

      // Add DynamoDB-backed routes to the FastAPI, exercising the generated
      // PynamoDB ExampleModel (create/get/list-by-category) so the serve-local
      // test can drive the Python DynamoDB client end-to-end over HTTP. Imports
      // are prepended so they stay at the top of the module (ruff E402).
      const pyApiMainFile = `${projectRoot}/packages/py_api/serve_local_test_py_api/main.py`;
      writeFileSync(
        pyApiMainFile,
        `from serve_local_test_py_table.entities.example import ExampleModel

${readFileSync(pyApiMainFile, 'utf-8')}

class ExampleItem(BaseModel):
    id: str
    name: str
    category: str


def _to_item(model: ExampleModel) -> ExampleItem:
    return ExampleItem(
        id=model.pk.split("#")[1], name=model.name, category=model.category
    )


@app.post("/examples")
def create_example(body: ExampleItem) -> ExampleItem:
    return _to_item(ExampleModel.create(body.id, body.name, body.category))


@app.get("/examples/{id}")
def get_example(id: str) -> ExampleItem:
    return _to_item(ExampleModel.get_by_id(id))


@app.get("/examples")
def list_examples_by_category(category: str) -> list[ExampleItem]:
    return [_to_item(m) for m in ExampleModel.list_by_category(category)]
`,
      );

      // Lint fix + build
      await runCLI(`sync --verbose`, opts);
      await runCLI(
        `run-many --target lint --all --fix --output-style=stream`,
        opts,
      );
      await runCLI(
        `run-many --target build --all --output-style=stream --verbose`,
        opts,
      );

      // Patch TS agents to use OpenAI mock
      for (const { project, dir } of [
        { project: 'ts-project', dir: 'my-agent' },
        { project: 'ts-project', dir: 'my-a2a-agent' },
        { project: 'ts-project', dir: 'my-agui-agent' },
        { project: 'ts-project', dir: 'gw-agent' },
      ]) {
        const file = `${projectRoot}/packages/${project}/src/${dir}/agent.ts`;
        let content = readFileSync(file, 'utf-8');
        content = `import { OpenAIModel } from '@strands-agents/sdk/models/openai';\n${content}`;
        content = content.replace(
          /new Agent\(\{/,
          `new Agent({\n    model: new OpenAIModel({ api: 'chat', modelId: 'mock', apiKey: 'test', clientConfig: { baseURL: 'http://127.0.0.1:${LLM_MOCK_PORT}/v1' } }),`,
        );
        writeFileSync(file, content);
      }

      // Patch Python agents to use OpenAI mock
      for (const dir of [
        'my_py_agent',
        'my_py_a2a_agent',
        'my_py_agui_agent',
        'gw_py_agent',
      ]) {
        const file = `${projectRoot}/packages/py_project/serve_local_test_py_project/${dir}/agent.py`;
        let content = readFileSync(file, 'utf-8');
        content = `from strands.models.openai import OpenAIModel\n${content}`;
        content = content.replace(
          /Agent\(\s*\n/,
          `Agent(\n        model=OpenAIModel(model_id="mock", client_args={"api_key": "test", "base_url": "http://127.0.0.1:${LLM_MOCK_PORT}/v1"}),\n`,
        );
        writeFileSync(file, content);
      }

      // Install openai dep for agents
      await runCLI(`pnpm add openai --filter=@serve-local-test/ts-project`, {
        cwd: projectRoot,
        prefixWithPackageManagerCmd: false,
      });
      await runCLI(`run serve_local_test.py_project:add -- openai`, opts);

      // Discover ports
      ports = {
        trpc: getPortFromProjectJson(
          projectRoot,
          'packages/my-api/project.json',
          'serve-local',
        ),
        fastApi: getPortFromProjectJson(
          projectRoot,
          'packages/py_api/project.json',
          'serve-local',
        ),
        smithy: getPortFromProjectJson(
          projectRoot,
          'packages/my-smithy-api/backend/project.json',
          'serve-local',
        ),
        tsAgent: getPortFromProjectJson(
          projectRoot,
          'packages/ts-project/project.json',
          'my-agent-serve-local',
        ),
        tsA2a: getPortFromProjectJson(
          projectRoot,
          'packages/ts-project/project.json',
          'my-a2a-agent-serve-local',
        ),
        tsAgui: getPortFromProjectJson(
          projectRoot,
          'packages/ts-project/project.json',
          'my-agui-agent-serve-local',
        ),
        tsMcp: getPortFromProjectJson(
          projectRoot,
          'packages/ts-project/project.json',
          'my-mcp-serve-local',
        ),
        pyAgent: getPortFromProjectJson(
          projectRoot,
          'packages/py_project/project.json',
          'my-py-agent-serve-local',
        ),
        pyA2a: getPortFromProjectJson(
          projectRoot,
          'packages/py_project/project.json',
          'my-py-a2a-agent-serve-local',
        ),
        pyAgui: getPortFromProjectJson(
          projectRoot,
          'packages/py_project/project.json',
          'my-py-agui-agent-serve-local',
        ),
        pyMcp: getPortFromProjectJson(
          projectRoot,
          'packages/py_project/project.json',
          'my-py-mcp-serve-local',
        ),
        rdb: getPortFromProjectJson(
          projectRoot,
          'packages/postgres-db/project.json',
          'serve-local',
        ),
        pyTable: getPortFromProjectJson(
          projectRoot,
          'packages/py_table/project.json',
          'serve-local',
        ),
        gwAgent: getPortFromProjectJson(
          projectRoot,
          'packages/ts-project/project.json',
          'gw-agent-serve-local',
        ),
        gwPyAgent: getPortFromProjectJson(
          projectRoot,
          'packages/py_project/project.json',
          'gw-py-agent-serve-local',
        ),
        gateway: getPortFromProjectJson(
          projectRoot,
          'packages/my-gateway/project.json',
          'my-gateway-serve-local',
        ),
        parentGateway: getPortFromProjectJson(
          projectRoot,
          'packages/parent-gateway/project.json',
          'parent-gateway-serve-local',
        ),
      };
      console.log('Ports discovered:', ports);
    },
    15 * 60 * 1000,
  );

  afterAll(async () => {
    await Promise.all(runningProcesses.map(killProcess));
    runningProcesses.length = 0;
    if (llmMock) await llmMock.stop();
    cleanupDynamoLocal();
  });

  afterEach(async () => {
    await Promise.all(runningProcesses.map(killProcess));
    runningProcesses.length = 0;
  });

  it('tRPC API - echo', async () => {
    await startAndWait('@serve-local-test/my-api:serve-local', ports.trpc);
    const input = encodeURIComponent(JSON.stringify({ message: 'hello' }));
    const res = await fetch(
      `http://127.0.0.1:${ports.trpc}/echo?input=${input}`,
    );
    const body = await res.json();
    console.log('tRPC echo response:', JSON.stringify(body));
    expect(body.result.data.message).toBe('hello');
    await stopLast();
  });

  it('FastAPI - echo + DynamoDB persists via PynamoDB client', async () => {
    // py_api:serve-local cascades DynamoDB Local (the FastAPI is connected to
    // the py#dynamodb table) and sets SERVE_LOCAL=true, so the generated
    // PynamoDB client points at the local table. Drive the echo route plus the
    // DynamoDB-backed routes over the one server lifecycle: a separate test
    // can't restart py_api:serve-local because uvicorn's dev reloader holds the
    // port briefly after stop (EADDRINUSE).
    await startAndWait('serve_local_test.py_api:serve-local', ports.fastApi);
    await waitForPort(ports.pyTable, STARTUP_TIMEOUT_MS);

    const base = `http://127.0.0.1:${ports.fastApi}`;

    const res = await fetch(`${base}/echo?message=hello`);
    const body = await res.json();
    console.log('FastAPI echo response:', JSON.stringify(body));
    expect(body.message).toBe('hello');

    // Wait out the gap between DynamoDB Local's port opening and the local
    // table being created, then assert the (empty) category query succeeds.
    const empty = await waitForJson(`${base}/examples?category=tools`, (b) =>
      Array.isArray(b),
    );
    console.log('examples (empty):', JSON.stringify(empty));
    expect(empty).toEqual([]);

    // Create persists through the PynamoDB client to DynamoDB Local
    const created = await fetch(`${base}/examples`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '1', name: 'Widget', category: 'tools' }),
    }).then((r) => r.json());
    console.log('create example:', JSON.stringify(created));
    expect(created.name).toBe('Widget');

    await fetch(`${base}/examples`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '2', name: 'Gadget', category: 'tools' }),
    }).then((r) => r.json());

    // Get reads the persisted item back via the primary key
    const fetched = await fetch(`${base}/examples/1`).then((r) => r.json());
    console.log('get example:', JSON.stringify(fetched));
    expect(fetched).toEqual({ id: '1', name: 'Widget', category: 'tools' });

    // List exercises a GSI query (gsi1 by category)
    const byCategory = await fetch(`${base}/examples?category=tools`).then(
      (r) => r.json(),
    );
    console.log('examples by category:', JSON.stringify(byCategory));
    expect(byCategory).toHaveLength(2);
    expect(byCategory.map((i: { id: string }) => i.id).sort()).toEqual([
      '1',
      '2',
    ]);

    await stopLast();
  });

  it('Smithy API - echo', async () => {
    await startAndWait(
      '@serve-local-test/my-smithy-api:serve-local',
      ports.smithy,
    );
    const res = await fetch(
      `http://127.0.0.1:${ports.smithy}/echo?message=hello`,
    );
    const body = await res.json();
    console.log('Smithy echo response:', JSON.stringify(body));
    expect(body.message).toBe('hello');
    await stopLast();
  });

  it('TS HTTP Agent - WebSocket streaming invoke', async () => {
    await startAndWait(
      '@serve-local-test/ts-project:my-agent-serve-local',
      ports.tsAgent,
    );

    const pingRes = await fetch(`http://127.0.0.1:${ports.tsAgent}/ping`);
    console.log('TS Agent /ping:', pingRes.status);
    expect(pingRes.status).toBe(200);

    const chunks = await new Promise<string[]>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('WS timed out')),
        30_000,
      );
      const ws = new WebSocket(`ws://127.0.0.1:${ports.tsAgent}/ws`);
      const data: string[] = [];
      ws.onopen = () =>
        ws.send(
          JSON.stringify({
            id: 1,
            method: 'subscription',
            params: {
              path: 'invoke',
              input: { message: 'What is 3 times 5?' },
            },
          }),
        );
      ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data));
        if (msg.result?.type === 'data')
          data.push(String(msg.result.data ?? ''));
        if (msg.result?.type === 'stopped') {
          clearTimeout(timeout);
          ws.close();
          resolve(data);
        }
        if (msg.error) {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(JSON.stringify(msg.error)));
        }
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('WS error'));
      };
    });
    console.log(`TS Agent streamed ${chunks.length} chunks:`, chunks.join(''));
    expect(chunks.length).toBeGreaterThan(0);

    // The standalone chat CLI connects to the running serve-local server and
    // streams the mock LLM's reply back through the interactive prompt.
    await chatStreamsReply(
      projectRoot,
      '@serve-local-test/ts-project:my-agent-chat',
      'The answer is 42',
      STARTUP_TIMEOUT_MS,
    );
    await stopLast();
  });

  it('TS HTTP Agent - AgentCore Gateway local gateway across multiple MCP servers', async () => {
    // The gateway fronts the TypeScript `my-mcp` and Python `my-py-mcp`
    // servers. Drive the LLM mock to call a gateway-prefixed tool
    // (`<target>___<tool>`) from each, and echo the tool result. A successful
    // round-trip for both proves the local gateway booted under SERVE_LOCAL,
    // aggregated tools from every attached MCP server, and routed each call
    // to the right upstream server. This exercises the gateway's core job:
    // aggregating multiple (heterogeneous) MCP servers behind one endpoint.
    type MockReq = {
      lastMessage: string;
      messages: { role: string; content: string }[];
    };
    // The mock issues whichever gateway-prefixed tool the user message names,
    // then echoes the tool result back on the follow-up turn. Scoped to the
    // `call <tool>` prompts (and their tool-result follow-ups) and bounded with
    // `.times(4)` (2 invocations x 2 turns each) + `.first()` so it neither
    // hijacks the shared fallback for other tests nor lingers afterwards.
    const resolver = (req: MockReq) => {
      const toolMsg = [...req.messages]
        .reverse()
        .find((m) => m.role === 'tool');
      if (toolMsg) return { text: `gateway tool returned ${toolMsg.content}` };
      const tool = req.lastMessage.replace('call ', '').trim();
      return { tools: [{ name: tool, args: { a: 6, b: 2 } }] };
    };
    const isGatewayTurn = (req: MockReq) =>
      req.lastMessage.startsWith('call my-') ||
      req.messages.some((m) => m.role === 'tool');
    llmMock!
      .when(isGatewayTurn as never)
      .reply(resolver as never)
      .first()
      .times(4);

    // gw-agent-serve-local chains the gateway's serve-local, which starts
    // both attached MCP servers (deduped with any other serve-local chains
    // in the same task graph).
    await startAndWait(
      '@serve-local-test/ts-project:gw-agent-serve-local',
      ports.gwAgent,
    );

    const invokeGatewayTool = (tool: string) =>
      new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('WS timed out')),
          60_000,
        );
        const ws = new WebSocket(`ws://127.0.0.1:${ports.gwAgent}/ws`);
        const data: string[] = [];
        ws.onopen = () =>
          ws.send(
            JSON.stringify({
              id: 1,
              method: 'subscription',
              params: { path: 'invoke', input: { message: `call ${tool}` } },
            }),
          );
        ws.onmessage = (ev) => {
          const msg = JSON.parse(String(ev.data));
          if (msg.result?.type === 'data')
            data.push(String(msg.result.data ?? ''));
          if (msg.result?.type === 'stopped') {
            clearTimeout(timeout);
            ws.close();
            resolve(data.join(''));
          }
          if (msg.error) {
            clearTimeout(timeout);
            ws.close();
            reject(new Error(JSON.stringify(msg.error)));
          }
        };
        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('WS error'));
        };
      });

    // TypeScript MCP server: divide(6, 2) = 3
    const tsResult = await invokeGatewayTool('my-mcp___divide');
    console.log('Gateway -> TS MCP (divide) stream:', tsResult);
    expect(tsResult).toContain('3');

    // Python MCP server: add(6, 2) = 8
    const pyResult = await invokeGatewayTool('my-py-mcp___add');
    console.log('Gateway -> Py MCP (add) stream:', pyResult);
    expect(pyResult).toContain('8');

    await stopLast();
  });

  it('Python HTTP Agent - AgentCore Gateway local gateway across multiple MCP servers', async () => {
    // Mirror of the TypeScript gateway test for a Python agent: the
    // `gw-py-agent` fronts the gateway, which aggregates the TypeScript
    // `my-mcp` and Python `my-py-mcp` servers. Drive the LLM mock to call a
    // gateway-prefixed tool (`<target>___<tool>`) from each and echo the
    // result. A successful round-trip for both proves the Python agent booted
    // the local gateway under SERVE_LOCAL, aggregated tools from every
    // attached MCP server, and routed each call to the right upstream server.
    type MockReq = {
      lastMessage: string;
      messages: { role: string; content: string }[];
    };
    const resolver = (req: MockReq) => {
      const toolMsg = [...req.messages]
        .reverse()
        .find((m) => m.role === 'tool');
      if (toolMsg) return { text: `gateway tool returned ${toolMsg.content}` };
      const tool = req.lastMessage.replace('call ', '').trim();
      return { tools: [{ name: tool, args: { a: 6, b: 2 } }] };
    };
    const isGatewayTurn = (req: MockReq) =>
      req.lastMessage.startsWith('call my-') ||
      req.messages.some((m) => m.role === 'tool');
    llmMock!
      .when(isGatewayTurn as never)
      .reply(resolver as never)
      .first()
      .times(4);

    // gw-py-agent-serve-local chains the gateway's serve-local, which starts
    // both attached MCP servers (deduped with any other serve-local chains in
    // the same task graph).
    await startAndWait(
      'serve_local_test.py_project:gw-py-agent-serve-local',
      ports.gwPyAgent,
    );

    const invokeGatewayTool = async (tool: string): Promise<string> => {
      const res = await fetch(
        `http://127.0.0.1:${ports.gwPyAgent}/invocations`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: `call ${tool}` }),
        },
      );
      const body = await res.text();
      const chunks = body
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      return chunks.map((c) => c.content ?? '').join('');
    };

    // TypeScript MCP server: divide(6, 2) = 3
    const tsResult = await invokeGatewayTool('my-mcp___divide');
    console.log('Py Agent Gateway -> TS MCP (divide) stream:', tsResult);
    expect(tsResult).toContain('3');

    // Python MCP server: add(6, 2) = 8
    const pyResult = await invokeGatewayTool('my-py-mcp___add');
    console.log('Py Agent Gateway -> Py MCP (add) stream:', pyResult);
    expect(pyResult).toContain('8');

    await stopLast();
  });

  it('AgentCore Gateway - chained local gateways (gateway -> gateway -> MCP servers)', async () => {
    // parent-gateway fronts my-gateway, which fronts the TypeScript `my-mcp`
    // and Python `my-py-mcp` servers. Starting the parent's serve-local boots
    // the whole chain. Listing tools on the parent must surface my-gateway's
    // (already prefixed) tools under a second prefix
    // (`my-gateway___<target>___<tool>`), and calling one must route
    // parent -> my-gateway -> the right upstream MCP server.
    const { Client } = await import(
      '@modelcontextprotocol/sdk/client/index.js'
    );
    const { StreamableHTTPClientTransport } = await import(
      '@modelcontextprotocol/sdk/client/streamableHttp.js'
    );

    await startAndWait(
      '@serve-local-test/parent-gateway:parent-gateway-serve-local',
      ports.parentGateway,
    );
    // The chain is started in dependency order; wait for the inner gateway
    // and MCP servers too so list/call below cannot race their startup.
    await waitForPort(ports.gateway, STARTUP_TIMEOUT_MS);
    await waitForPort(ports.tsMcp, STARTUP_TIMEOUT_MS);
    await waitForPort(ports.pyMcp, STARTUP_TIMEOUT_MS);

    const client = new Client({ name: 'e2e-test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${ports.parentGateway}/mcp`),
      ),
    );
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      console.log('Parent gateway aggregated tools:', names);
      expect(names).toContain('my-gateway___my-mcp___divide');
      expect(names).toContain('my-gateway___my-py-mcp___add');

      // TypeScript MCP server through both gateways: divide(6, 2) = 3
      const divide = await client.callTool({
        name: 'my-gateway___my-mcp___divide',
        arguments: { a: 6, b: 2 },
      });
      console.log('Chained gateway divide result:', JSON.stringify(divide));
      expect(JSON.stringify(divide)).toContain('3');

      // Python MCP server through both gateways: add(6, 2) = 8
      const add = await client.callTool({
        name: 'my-gateway___my-py-mcp___add',
        arguments: { a: 6, b: 2 },
      });
      console.log('Chained gateway add result:', JSON.stringify(add));
      expect(JSON.stringify(add)).toContain('8');
    } finally {
      await client.close();
    }
    await stopLast();
  });

  it('TS A2A Agent - card + streaming message', async () => {
    await startAndWait(
      '@serve-local-test/ts-project:my-a2a-agent-serve-local',
      ports.tsA2a,
    );

    const cardRes = await fetch(
      `http://127.0.0.1:${ports.tsA2a}/.well-known/agent-card.json`,
    );
    const card = await cardRes.json();
    console.log('TS A2A agent card:', card.name);
    expect(card.name).toBeDefined();

    const streamRes = await fetch(`http://127.0.0.1:${ports.tsA2a}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '1',
        method: 'message/stream',
        params: {
          message: {
            messageId: 'msg-1',
            role: 'user',
            parts: [{ kind: 'text', text: 'What is 3 times 5?' }],
          },
        },
      }),
    });
    const streamBody = await streamRes.text();
    console.log(
      `TS A2A stream response (${streamRes.status}, ${streamBody.length} bytes):`,
      streamBody.slice(0, 200),
    );
    expect(streamRes.status).toBe(200);
    expect(streamBody).toContain('data:');

    await chatStreamsReply(
      projectRoot,
      '@serve-local-test/ts-project:my-a2a-agent-chat',
      'The answer is 42',
      STARTUP_TIMEOUT_MS,
    );
    await stopLast();
  });

  it('TS AG-UI Agent - streaming invocation', async () => {
    await startAndWait(
      '@serve-local-test/ts-project:my-agui-agent-serve-local',
      ports.tsAgui,
    );

    const res = await fetch(`http://127.0.0.1:${ports.tsAgui}/invocations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadId: 'test-thread',
        runId: 'test-run',
        messages: [
          { id: 'msg-1', role: 'user', content: 'What is 3 times 5?' },
        ],
        state: {},
        tools: [],
        context: [],
        forwardedProps: {},
      }),
    });
    const body = await res.text();
    console.log(
      `TS AG-UI response (${res.status}, ${body.length} bytes):`,
      body.slice(0, 200),
    );
    expect(res.status).toBe(200);
    expect(body).toContain('data:');

    await chatStreamsReply(
      projectRoot,
      '@serve-local-test/ts-project:my-agui-agent-chat',
      'The answer is 42',
      STARTUP_TIMEOUT_MS,
    );
    await stopLast();
  });

  it('Python HTTP Agent - JSONL streaming invoke', async () => {
    await startAndWait(
      'serve_local_test.py_project:my-py-agent-serve-local',
      ports.pyAgent,
    );

    const pingRes = await fetch(`http://127.0.0.1:${ports.pyAgent}/ping`);
    console.log('Python Agent /ping:', pingRes.status);
    expect(pingRes.status).toBe(200);

    const res = await fetch(`http://127.0.0.1:${ports.pyAgent}/invocations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'What is 3 times 5?' }),
    });
    const body = await res.text();
    const lines = body.trim().split('\n').filter(Boolean);
    const chunks = lines.map((l) => JSON.parse(l));
    console.log(
      `Python Agent streamed ${chunks.length} JSONL chunks:`,
      chunks.map((c) => c.content).join(''),
    );
    expect(res.status).toBe(200);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toHaveProperty('content');

    // HTTP chat builds the generated client first, then connects.
    await chatStreamsReply(
      projectRoot,
      'serve_local_test.py_project:my-py-agent-chat',
      'The answer is 42',
      STARTUP_TIMEOUT_MS,
    );
    await stopLast();
  });

  it('Python A2A Agent - card + streaming message', async () => {
    await startAndWait(
      'serve_local_test.py_project:my-py-a2a-agent-serve-local',
      ports.pyA2a,
    );

    const cardRes = await fetch(
      `http://127.0.0.1:${ports.pyA2a}/.well-known/agent-card.json`,
    );
    const card = await cardRes.json();
    console.log('Python A2A agent card:', card.name);
    expect(card.name).toBeDefined();

    const streamRes = await fetch(`http://127.0.0.1:${ports.pyA2a}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '1',
        method: 'message/stream',
        params: {
          message: {
            messageId: 'msg-1',
            role: 'user',
            parts: [{ kind: 'text', text: 'What is 3 times 5?' }],
          },
        },
      }),
    });
    const streamBody = await streamRes.text();
    console.log(
      `Python A2A stream (${streamRes.status}, ${streamBody.length} bytes):`,
      streamBody.slice(0, 200),
    );
    expect(streamRes.status).toBe(200);
    expect(streamBody).toContain('data:');

    await chatStreamsReply(
      projectRoot,
      'serve_local_test.py_project:my-py-a2a-agent-chat',
      'The answer is 42',
      STARTUP_TIMEOUT_MS,
    );
    await stopLast();
  });

  it('Python AG-UI Agent - streaming invocation', async () => {
    await startAndWait(
      'serve_local_test.py_project:my-py-agui-agent-serve-local',
      ports.pyAgui,
    );

    const res = await fetch(`http://127.0.0.1:${ports.pyAgui}/invocations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadId: 'test-thread',
        runId: 'test-run',
        messages: [
          { id: 'msg-1', role: 'user', content: 'What is 3 times 5?' },
        ],
        state: {},
        tools: [],
        context: [],
        forwardedProps: {},
      }),
    });
    const body = await res.text();
    console.log(
      `Python AG-UI response (${res.status}, ${body.length} bytes):`,
      body.slice(0, 200),
    );
    expect(res.status).toBe(200);
    expect(body).toContain('data:');

    await chatStreamsReply(
      projectRoot,
      'serve_local_test.py_project:my-py-agui-agent-chat',
      'The answer is 42',
      STARTUP_TIMEOUT_MS,
    );
    await stopLast();
  });

  it('TS MCP Server - initialize handshake', async () => {
    await startAndWait(
      '@serve-local-test/ts-project:my-mcp-serve-local',
      ports.tsMcp,
    );

    const res = await fetch(`http://127.0.0.1:${ports.tsMcp}/mcp`, {
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
    const body = await res.text();
    console.log(`TS MCP initialize (${res.status}):`, body.slice(0, 200));
    expect(res.status).toBe(200);
    await stopLast();
  });

  it('Python MCP Server - initialize handshake', async () => {
    await startAndWait(
      'serve_local_test.py_project:my-py-mcp-serve-local',
      ports.pyMcp,
    );

    const res = await fetch(`http://127.0.0.1:${ports.pyMcp}/mcp`, {
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
    const body = await res.text();
    console.log(`Python MCP initialize (${res.status}):`, body.slice(0, 200));
    expect(res.status).toBe(200);
    await stopLast();
  });

  it('PostgreSQL RDB - Docker start + ready', async () => {
    await startAndWait('@serve-local-test/postgres-db:serve-local', ports.rdb);
    console.log(`Postgres listening on port ${ports.rdb}`);

    await runCLI(`run @serve-local-test/postgres-db:wait-for-db`, {
      cwd: projectRoot,
      env: { NX_DAEMON: 'true' },
    });
    console.log('Postgres ready for queries');
    await stopLast();
  });

  it('Website cascade - starts connected APIs', async () => {
    await startAndWait('@serve-local-test/website:serve-local', 4200);

    // Wait for cascaded backends
    await waitForPort(ports.trpc, STARTUP_TIMEOUT_MS);
    await waitForPort(ports.fastApi, STARTUP_TIMEOUT_MS);

    const htmlRes = await fetch('http://127.0.0.1:4200/');
    const html = await htmlRes.text();
    console.log(`Website (${htmlRes.status}): ${html.slice(0, 100)}`);
    expect(htmlRes.status).toBe(200);
    expect(html).toContain('<');

    const trpcInput = encodeURIComponent(
      JSON.stringify({ message: 'cascade' }),
    );
    const trpcRes = await fetch(
      `http://127.0.0.1:${ports.trpc}/echo?input=${trpcInput}`,
    );
    const trpcBody = await trpcRes.json();
    console.log('tRPC cascade echo:', JSON.stringify(trpcBody));
    expect(trpcBody.result.data.result).toBe('cascade');

    const fastApiRes = await fetch(
      `http://127.0.0.1:${ports.fastApi}/echo?message=cascade`,
    );
    const fastApiBody = await fastApiRes.json();
    console.log('FastAPI cascade echo:', JSON.stringify(fastApiBody));
    expect(fastApiBody.message).toBe('cascade');

    await stopLast();
  });
});
