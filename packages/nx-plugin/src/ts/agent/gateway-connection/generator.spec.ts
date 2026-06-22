/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import {
  TS_AGENT_GATEWAY_CONNECTION_GENERATOR_INFO,
  tsAgentGatewayConnectionGenerator,
} from './generator';

describe('ts#agent#gateway-connection generator', () => {
  let tree: Tree;

  const setupProjects = () => {
    tree.write(
      'packages/my-api/project.json',
      JSON.stringify({
        name: '@test/my-api',
        root: 'packages/my-api',
        sourceRoot: 'packages/my-api/src',
        targets: {
          build: {},
          'my-agent-serve-local': {
            executor: 'nx:run-commands',
            options: { commands: ['echo serve-local'] },
            dependsOn: [],
            continuous: true,
          },
        },
        metadata: { components: [] },
      }),
    );
    tree.write(
      'packages/my-api/src/my-agent/agent.ts',
      `import { Agent, tool } from '@strands-agents/sdk';
import { z } from 'zod';

const multiply = tool({
  name: 'Multiply',
  description: 'Multiply two numbers',
  inputSchema: z.object({ a: z.number(), b: z.number() }),
  callback: ({ a, b }) => a * b,
});

export const getAgent = async (sessionId: string) =>
  new Agent({
    systemPrompt: 'You are a mathematical wizard.',
    tools: [multiply],
  });
`,
    );

    tree.write(
      'packages/my-gateway/project.json',
      JSON.stringify({
        name: '@test/my-gateway',
        root: 'packages/my-gateway',
        sourceRoot: 'packages/my-gateway',
        metadata: {
          generator: 'agentcore-gateway',
          name: 'my-gateway',
          rc: 'MyGateway',
          protocol: 'mcp',
          auth: 'iam',
          port: 8100,
        },
        targets: {
          'my-gateway-serve-local': {
            executor: 'nx:run-commands',
            options: {
              commands: ['node -e "setInterval(()=>{}, 1000)"'],
            },
            continuous: true,
            dependsOn: [],
          },
        },
      }),
    );
  };

  const fullOptions = () => ({
    sourceProject: '@test/my-api',
    targetProject: '@test/my-gateway',
    sourceComponent: {
      generator: 'ts#agent',
      name: 'my-agent',
      path: 'src/my-agent',
      port: 8081,
      rc: 'MyAgent',
      auth: 'iam',
    } as any,
  });

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('generates the agent-connection project and gateway client templates', async () => {
    setupProjects();
    await tsAgentGatewayConnectionGenerator(tree, fullOptions());

    expect(tree.exists('packages/common/agent-connection/project.json')).toBe(
      true,
    );
    expect(
      tree.exists(
        'packages/common/agent-connection/src/core/agentcore-gateway-mcp-client-strands.ts',
      ),
    ).toBe(true);
    // Framework-agnostic transport layer shared with the MCP client
    expect(
      tree.exists(
        'packages/common/agent-connection/src/core/agentcore-gateway-mcp-transport.ts',
      ),
    ).toBe(true);
    expect(
      tree.exists(
        'packages/common/agent-connection/src/core/agentcore-transport.ts',
      ),
    ).toBe(true);
    expect(
      tree.exists(
        'packages/common/agent-connection/src/core/agentcore-fetch.ts',
      ),
    ).toBe(true);
    expect(
      tree.exists(
        'packages/common/agent-connection/src/app/my-gateway-client-strands.ts',
      ),
    ).toBe(true);
  });

  it('emits a per-connection client with the gateway class name', async () => {
    setupProjects();
    await tsAgentGatewayConnectionGenerator(tree, fullOptions());

    const client = tree
      .read('packages/common/agent-connection/src/app/my-gateway-client-strands.ts')!
      .toString();
    expect(client).toContain('export class MyGatewayClientStrands');
    expect(client).toContain("config.gateways?.['MyGateway']");
    expect(client).toContain('SERVE_LOCAL');
    // create() returns a single McpClient in both modes
    expect(client).toContain('Promise<McpClient>');
  });

  it('points local mode at the gateway port from project metadata', async () => {
    setupProjects();
    const gatewayConfig = JSON.parse(
      tree.read('packages/my-gateway/project.json')!.toString(),
    );
    gatewayConfig.metadata.port = 8123;
    tree.write(
      'packages/my-gateway/project.json',
      JSON.stringify(gatewayConfig),
    );
    await tsAgentGatewayConnectionGenerator(tree, fullOptions());

    const client = tree
      .read('packages/common/agent-connection/src/app/my-gateway-client-strands.ts')!
      .toString();
    expect(client).toContain("gatewayUrl: 'http://localhost:8123/mcp'");
    expect(client).toContain('withoutAuth');
  });

  it('exposes the shared getAgentCoreRuntimeConfig helper', async () => {
    setupProjects();
    await tsAgentGatewayConnectionGenerator(tree, fullOptions());

    const runtimeConfig = tree
      .read('packages/common/agent-connection/src/core/runtime-config.ts')!
      .toString();
    expect(runtimeConfig).toContain('export const getAgentCoreRuntimeConfig');
  });

  it('re-exports the gateway client from the agent-connection index', async () => {
    setupProjects();
    await tsAgentGatewayConnectionGenerator(tree, fullOptions());

    const index = tree
      .read('packages/common/agent-connection/src/index.ts')!
      .toString();
    expect(index).toContain('my-gateway-client-strands');
  });

  it('adds the gateway client into the agent source file', async () => {
    setupProjects();
    await tsAgentGatewayConnectionGenerator(tree, fullOptions());

    const agent = tree
      .read('packages/my-api/src/my-agent/agent.ts')!
      .toString();
    expect(agent).toContain('MyGatewayClientStrands');
    expect(agent).toContain('agent-connection');
    expect(agent).toContain('MyGatewayClientStrands.create()');
    expect(agent).toContain('myGateway, multiply');
  });

  it('chains agent serve-local onto gateway serve-local', async () => {
    setupProjects();
    await tsAgentGatewayConnectionGenerator(tree, fullOptions());

    const cfg = JSON.parse(
      tree.read('packages/my-api/project.json')!.toString(),
    );
    const deps = cfg.targets['my-agent-serve-local'].dependsOn;
    expect(deps).toContainEqual(
      expect.objectContaining({
        projects: ['@test/my-gateway'],
        target: 'my-gateway-serve-local',
      }),
    );
  });

  it('is idempotent: re-running does not duplicate client creation or tool list entries', async () => {
    setupProjects();
    await tsAgentGatewayConnectionGenerator(tree, fullOptions());
    await tsAgentGatewayConnectionGenerator(tree, fullOptions());

    const agent = tree
      .read('packages/my-api/src/my-agent/agent.ts')!
      .toString();
    const createCount = (agent.match(/MyGatewayClientStrands\.create/g) ?? [])
      .length;
    expect(createCount).toBe(1);
    const toolsArrayMatches = agent.match(/myGateway/g) ?? [];
    // Expect exactly: declaration + tools reference
    expect(toolsArrayMatches.length).toBeLessThanOrEqual(3);
  });

  it('rejects a missing source component ref', async () => {
    setupProjects();
    await expect(
      tsAgentGatewayConnectionGenerator(tree, {
        sourceProject: '@test/my-api',
        targetProject: '@test/my-gateway',
      }),
    ).rejects.toThrow(/sourceComponent must be provided/);
  });

  it('rejects a target project not generated by agentcore-gateway', async () => {
    setupProjects();
    const gatewayConfig = JSON.parse(
      tree.read('packages/my-gateway/project.json')!.toString(),
    );
    gatewayConfig.metadata.generator = 'ts#project';
    tree.write(
      'packages/my-gateway/project.json',
      JSON.stringify(gatewayConfig),
    );
    await expect(
      tsAgentGatewayConnectionGenerator(tree, fullOptions()),
    ).rejects.toThrow(/was not generated by/);
  });

  it('rejects non-MCP gateway protocol', async () => {
    setupProjects();
    const gatewayConfig = JSON.parse(
      tree.read('packages/my-gateway/project.json')!.toString(),
    );
    gatewayConfig.metadata.protocol = 'Runtime';
    tree.write(
      'packages/my-gateway/project.json',
      JSON.stringify(gatewayConfig),
    );
    await expect(
      tsAgentGatewayConnectionGenerator(tree, fullOptions()),
    ).rejects.toThrow(/Only MCP-protocol gateways are supported/);
  });

  it('rejects gateway with non-IAM inbound auth', async () => {
    setupProjects();
    const gatewayConfig = JSON.parse(
      tree.read('packages/my-gateway/project.json')!.toString(),
    );
    gatewayConfig.metadata.auth = 'Cognito';
    tree.write(
      'packages/my-gateway/project.json',
      JSON.stringify(gatewayConfig),
    );
    await expect(
      tsAgentGatewayConnectionGenerator(tree, fullOptions()),
    ).rejects.toThrow(/Only IAM-authenticated gateways/);
  });

  it('rejects non-IAM agent', async () => {
    setupProjects();
    await expect(
      tsAgentGatewayConnectionGenerator(tree, {
        ...fullOptions(),
        sourceComponent: {
          ...fullOptions().sourceComponent,
          auth: 'Cognito',
        } as any,
      }),
    ).rejects.toThrow(/Only IAM-authenticated agents/);
  });

  it('should match snapshot for agent-connection src files', async () => {
    setupProjects();
    await tsAgentGatewayConnectionGenerator(tree, fullOptions());

    const base = 'packages/common/agent-connection/src';
    const snap = (path: string, name: string) =>
      expect(tree.read(`${base}/${path}`, 'utf-8')).toMatchSnapshot(name);

    // Layer 2 (Strands wrapper) -> Layer 1 (transport) -> Layer 0 (fetch)
    snap(
      'core/agentcore-gateway-mcp-client-strands.ts',
      'agentcore-gateway-mcp-client-strands.ts',
    );
    snap(
      'core/agentcore-gateway-mcp-transport.ts',
      'agentcore-gateway-mcp-transport.ts',
    );
    snap('core/agentcore-transport.ts', 'agentcore-transport.ts');
    snap('core/agentcore-fetch.ts', 'agentcore-fetch.ts');
    // Per-connection client + barrel
    snap('app/my-gateway-client-strands.ts', 'my-gateway-client-strands.ts');
    snap('index.ts', 'agent-connection-index.ts');
  });

  it('exposes stable generator info id', () => {
    expect(TS_AGENT_GATEWAY_CONNECTION_GENERATOR_INFO.id).toBe(
      'ts#agent#gateway-connection',
    );
  });
});
