/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type ChildProcess, spawn } from 'child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { ensureDirSync } from 'fs-extra';
import type { MockServer } from 'llm-mock-server';
import { createConnection } from 'net';
import { buildCreateNxWorkspaceCommand, runCLI, tmpProjPath } from '../utils';
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
 * Run an `agent-chat` target against an already-running `serve-local` server
 * and resolve once the standalone chat CLI prints its connection banner. The
 * chat loop's message prompt needs a TTY to submit input, so we assert on the
 * connection (proving the standalone script boots, resolves the local URL, and
 * connects) rather than driving a full conversation. Rejects if the banner is
 * not seen before the timeout.
 */
function chatConnects(
  cwd: string,
  target: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'nx', 'run', target], {
      cwd,
      detached: true,
      // Ensure local-only resolution — no deployed-agent lookup.
      env: { ...process.env, NX_DAEMON: 'true', RUNTIME_CONFIG_APP_ID: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // already dead
        }
      }
      err ? reject(err) : resolve();
    };
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            `Chat target ${target} did not connect within ${timeoutMs}ms. Output:\n${output}`,
          ),
        ),
      timeoutMs,
    );
    const onData = (d: Buffer) => {
      const text = d.toString();
      output += text;
      process.stdout.write(`[${target}] ${text}`);
      // `agent-chat-cli` prints "Connected to <agentName>" on success.
      if (/Connected to /.test(output)) {
        finish();
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (err) => finish(err));
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

      await runCLI(
        `${buildCreateNxWorkspaceCommand(pkgMgr, 'serve-local-test', 'cdk')} --interactive=false --skipGit`,
        {
          cwd: targetDir,
          prefixWithPackageManagerCmd: false,
          redirectStderr: true,
        },
      );
      projectRoot = `${targetDir}/serve-local-test`;
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
      // AgentCore Gateway: a dedicated agent fronted only by the gateway,
      // which aggregates the same TS and Python MCP servers used by the
      // direct-connection tests above (Nx dedupes the shared continuous
      // serve-local targets within a single task graph).
      await runCLI(
        `generate @aws/nx-plugin:ts#agent --project=ts-project --name=gw-agent --infra=none --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:agentcore-gateway --name=my-gateway --no-interactive`,
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
        `generate @aws/nx-plugin:connection --sourceProject=ts-project --sourceComponent=my-agent --targetProject=ts-project --targetComponent=my-mcp --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:connection --sourceProject=py_project --sourceComponent=my-py-agent --targetProject=py_project --targetComponent=my-py-mcp --no-interactive`,
        opts,
      );
      // Gateway wiring: gw-agent -> gateway -> {my-mcp, my-py-mcp}. The
      // agent's serve-local boots the local gateway, which aggregates both
      // MCP servers behind one endpoint.
      await runCLI(
        `generate @aws/nx-plugin:connection --sourceProject=ts-project --sourceComponent=gw-agent --targetProject=my-gateway --no-interactive`,
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
        gwAgent: getPortFromProjectJson(
          projectRoot,
          'packages/ts-project/project.json',
          'gw-agent-serve-local',
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
    expect(body.result.data.result).toBe('hello');
    await stopLast();
  });

  it('FastAPI - echo', async () => {
    await startAndWait('serve_local_test.py_api:serve-local', ports.fastApi);
    const res = await fetch(
      `http://127.0.0.1:${ports.fastApi}/echo?message=hello`,
    );
    const body = await res.json();
    console.log('FastAPI echo response:', JSON.stringify(body));
    expect(body.message).toBe('hello');
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

    // The standalone chat CLI connects to the running serve-local server.
    await chatConnects(
      projectRoot,
      '@serve-local-test/ts-project:my-agent-chat',
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

    await chatConnects(
      projectRoot,
      '@serve-local-test/ts-project:my-a2a-agent-chat',
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

    await chatConnects(
      projectRoot,
      '@serve-local-test/ts-project:my-agui-agent-chat',
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
    await chatConnects(
      projectRoot,
      'serve_local_test.py_project:my-py-agent-chat',
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

    await chatConnects(
      projectRoot,
      'serve_local_test.py_project:my-py-a2a-agent-chat',
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

    await chatConnects(
      projectRoot,
      'serve_local_test.py_project:my-py-agui-agent-chat',
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
