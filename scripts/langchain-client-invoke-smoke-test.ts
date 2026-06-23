/**
 * Invoke-smoke-test for the generated TypeScript LangChain Layer-2 MCP / gateway
 * clients (the TS twin of langchain-client-invoke-smoke-test.py).
 *
 * This is NOT a generated template (no `.template` suffix, and it lives in the
 * repo-root scripts/ dir so the package assets glob does not ship it). It is a
 * standalone proof that the client templates under
 * `utils/agent-connection/files/core-langchain/{mcp,gateway}` produce LangChain
 * tools that can actually be INVOKED after construction. That is the gap that
 * let the dead-on-arrival bug through on the Python side twice: the generator
 * specs only assert template string content, they never invoke a tool.
 *
 * It renders the relevant `*.template` files into a temporary project mirroring
 * the flat `core/` layout the connection generators emit, installs the runtime
 * deps the langchain client needs, stands up a trivial in-process
 * streamable-HTTP MCP server exposing one `echo` tool, points the generated
 * `withoutAuth` client at it (so no SigV4 / AWS credentials are needed), loads
 * the tools through the generated client, then INVOKES one and asserts it
 * returns rather than failing on a closed connection.
 *
 * The matching negative control: after the positive checks, the stub server is
 * shut down and a previously-loaded tool is invoked again — that invocation MUST
 * reject (the live connection is gone). This proves the smoke test would catch a
 * dead-on-arrival regression (a client that closed its connection after loading
 * its tools), which is the exact bug this guard exists for.
 *
 * Run it:
 *   PATH=/Users/dtrnbull/.local/share/mise/installs/node/22.22.3/bin:$PATH \
 *     node_modules/.bin/tsx scripts/langchain-client-invoke-smoke-test.ts
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createServer, type Server } from 'node:http';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const TEMPLATES_ROOT = join(
  REPO_ROOT,
  'packages/nx-plugin/src/utils/agent-connection/files',
);

// Map each generated core file to the template that produces it (flat layout,
// exactly as the mcp-/gateway-connection generators emit into src/core/). We
// exercise the core langchain clients directly rather than the per-connection
// wrappers, so no `.js` import-path rewriting is needed.
const CORE_FILES: Record<string, string> = {
  'session-context.ts': 'core-runtime-config/session-context.ts.template',
  'agentcore-fetch.ts': 'core-auth/agentcore-fetch.ts.template',
  'agentcore-endpoints.ts': 'core-auth/agentcore-endpoints.ts.template',
  'agentcore-transport.ts': 'core-shared/agentcore-transport.ts.template',
  'agentcore-mcp-transport.ts': 'core-mcp/agentcore-mcp-transport.ts.template',
  'agentcore-gateway-mcp-transport.ts':
    'core-gateway/agentcore-gateway-mcp-transport.ts.template',
  'agentcore-mcp-client-langchain.ts':
    'core-langchain/mcp/agentcore-mcp-client-langchain.ts.template',
  'agentcore-gateway-mcp-client-langchain.ts':
    'core-langchain/gateway/agentcore-gateway-mcp-client-langchain.ts.template',
};

function renderCore(dest: string): void {
  const core = join(dest, 'core');
  mkdirSync(core, { recursive: true });
  for (const [rel, template] of Object.entries(CORE_FILES)) {
    const content = readFileSync(join(TEMPLATES_ROOT, template), 'utf-8');
    if (content.includes('<%')) {
      throw new Error(`${template} carries unrendered EJS tags`);
    }
    writeFileSync(join(core, rel), content);
  }
}

// A minimal streamable-HTTP MCP server exposing a single `echo` tool, built on
// the @modelcontextprotocol/sdk. Stateless JSON-response mode: a fresh
// server+transport is created per request (the canonical stateless pattern,
// which avoids request-id collisions and SSE stream bookkeeping). The generated
// client speaks the Streamable HTTP client protocol against it.
async function startStubServer(port: number): Promise<Server> {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { StreamableHTTPServerTransport } = await import(
    '@modelcontextprotocol/sdk/server/streamableHttp.js'
  );
  const { z } = await import('zod');

  const buildServer = () => {
    const mcp = new McpServer({ name: 'stub', version: '1.0.0' });
    mcp.registerTool(
      'echo',
      {
        description: 'Echo the input back.',
        inputSchema: { text: z.string() },
      },
      async ({ text }: { text: string }) => ({
        content: [{ type: 'text' as const, text: `echoed:${text}` }],
      }),
    );
    return mcp;
  };

  const server = createServer((req, res) => {
    if (!req.url?.startsWith('/mcp')) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      void (async () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        const body = raw ? JSON.parse(raw) : undefined;
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined, // stateless
          enableJsonResponse: true, // plain JSON, no SSE: simplest for a stub
        });
        res.on('close', () => void transport.close());
        const mcp = buildServer();
        await mcp.connect(transport);
        await transport.handleRequest(req, res, body);
      })();
    });
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  return server;
}

async function main(): Promise<number> {
  const dest = mkdtempSync(join(tmpdir(), 'lc-mcp-smoke-ts-'));
  let server: Server | undefined;
  try {
    renderCore(dest);

    // A tiny package in the temp dir so the langchain runtime deps resolve via a
    // local install (they are not in the repo root node_modules). The MCP SDK +
    // aws4fetch + credential-providers are linked from the repo root.
    writeFileSync(
      join(dest, 'package.json'),
      JSON.stringify(
        {
          name: 'lc-smoke',
          private: true,
          type: 'module',
          dependencies: {
            '@langchain/core': '1.1.48',
            '@langchain/mcp-adapters': '1.1.3',
            '@langchain/langgraph': '1.2.5',
            '@modelcontextprotocol/sdk': '1.29.0',
            zod: '4.4.3',
            aws4fetch: '1.0.20',
            '@aws-sdk/credential-providers': '3.1068.0',
          },
        },
        null,
        2,
      ),
    );
    console.log('installing langchain runtime deps into the smoke temp dir...');
    execSync('npm install --no-audit --no-fund --loglevel=error', {
      cwd: dest,
      stdio: 'inherit',
    });

    const port = 38242;
    server = await startStubServer(port);
    const url = `http://127.0.0.1:${port}/mcp`;

    // Import the rendered clients from the temp project (so their @langchain
    // imports resolve against the temp node_modules).
    const mcpClientMod = await import(
      join(dest, 'core', 'agentcore-mcp-client-langchain.ts')
    );
    const gwClientMod = await import(
      join(dest, 'core', 'agentcore-gateway-mcp-client-langchain.ts')
    );

    const exercise = async (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ClientCls: any,
      label: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): Promise<any> => {
      const tools = await ClientCls.withoutAuth(
        label === 'gateway' ? { gatewayUrl: url } : { url },
      );
      const names = tools.map((t: { name: string }) => t.name);
      if (!names.includes('echo')) {
        throw new Error(`${label}: echo tool missing, got ${names}`);
      }
      const echoTool = tools.find((t: { name: string }) => t.name === 'echo');
      // INVOKE after construction. If the client/transport were closed after
      // loading, this would reject on a dead connection.
      const result = await echoTool.invoke({ text: 'hello' });
      if (!String(result).includes('echoed:hello')) {
        throw new Error(`${label}: unexpected result ${JSON.stringify(result)}`);
      }
      console.log(
        `${label}: loaded ${JSON.stringify(names)}, invoke returned ${JSON.stringify(
          result,
        )} -> PASS`,
      );
      return echoTool;
    };

    await exercise(mcpClientMod.AgentCoreMcpClientLangChain, 'mcp');
    const liveGatewayTool = await exercise(
      gwClientMod.AgentCoreGatewayMcpClientLangChain,
      'gateway',
    );

    // Negative control: kill the server, then re-invoke a tool whose connection
    // was live a moment ago. With the server gone the invocation MUST reject —
    // confirming the test actually detects a dead connection (i.e. it would have
    // caught the close-after-load / dead-on-arrival regression).
    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
    let rejected = false;
    try {
      await liveGatewayTool.invoke({ text: 'hello' });
    } catch {
      rejected = true;
    }
    if (!rejected) {
      throw new Error(
        'negative control FAILED: invoke against a dead server did not reject, ' +
          'so the smoke test cannot detect a closed/dead connection',
      );
    }
    console.log('negative control: invoke after server shutdown rejected -> PASS');

    console.log('SMOKE PASS');
    return 0;
  } finally {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    rmSync(dest, { recursive: true, force: true });
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
