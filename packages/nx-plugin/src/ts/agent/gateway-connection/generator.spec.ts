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
    targetComponent: {
      generator: 'cedar#agentcore-gateway',
      name: 'my-gateway',
      rc: 'MyGateway',
      protocol: 'mcp',
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
        'packages/common/agent-connection/src/core/agentcore-gateway-mcp-client.ts',
      ),
    ).toBe(true);
    expect(
      tree.exists(
        'packages/common/agent-connection/src/core/agentcore-gateway-mcp-local-client.ts',
      ),
    ).toBe(true);
    expect(
      tree.exists(
        'packages/common/agent-connection/src/app/my-gateway-client.ts',
      ),
    ).toBe(true);
  });

  it('emits a per-connection client with the gateway class name', async () => {
    setupProjects();
    await tsAgentGatewayConnectionGenerator(tree, fullOptions());

    const client = tree
      .read('packages/common/agent-connection/src/app/my-gateway-client.ts')!
      .toString();
    expect(client).toContain('export class MyGatewayClient');
    expect(client).toContain("getConnectedGatewayUrl('MyGateway')");
    expect(client).toContain('SERVE_LOCAL');
    expect(client).toContain('ATTACHED_MCP_SERVERS');
    // create() returns a single McpClient in both modes
    expect(client).toContain('Promise<McpClient>');
  });

  it('seeds ATTACHED_MCP_SERVERS from MCP servers already attached to the gateway', async () => {
    setupProjects();
    // Simulate a prior `cedar#agentcore-gateway#mcp-connection` run: the
    // gateway's serve-local aggregator depends on an MCP server target.
    tree.write(
      'packages/my-mcp/project.json',
      JSON.stringify({
        name: '@test/my-mcp',
        root: 'packages/my-mcp',
        sourceRoot: 'packages/my-mcp/src',
        metadata: {
          components: [
            { generator: 'ts#mcp-server', name: 'my-mcp', port: 8123 },
          ],
        },
      }),
    );
    const gatewayConfig = JSON.parse(
      tree.read('packages/my-gateway/project.json')!.toString(),
    );
    gatewayConfig.targets['my-gateway-serve-local'].dependsOn = [
      { projects: ['@test/my-mcp'], target: 'my-mcp-serve-local' },
    ];
    tree.write(
      'packages/my-gateway/project.json',
      JSON.stringify(gatewayConfig),
    );

    await tsAgentGatewayConnectionGenerator(tree, fullOptions());

    const client = tree
      .read('packages/common/agent-connection/src/app/my-gateway-client.ts')!
      .toString();
    expect(client).toContain("name: 'my-mcp'");
    expect(client).toContain("localUrl: 'http://localhost:8123/mcp'");
  });

  it('defines getConnectedGatewayUrl in the shared runtime-config helper', async () => {
    setupProjects();
    await tsAgentGatewayConnectionGenerator(tree, fullOptions());

    const runtimeConfig = tree
      .read('packages/common/agent-connection/src/core/runtime-config.ts')!
      .toString();
    expect(runtimeConfig).toContain('export const getConnectedGatewayUrl');
  });

  it('re-exports the gateway client from the agent-connection index', async () => {
    setupProjects();
    await tsAgentGatewayConnectionGenerator(tree, fullOptions());

    const index = tree
      .read('packages/common/agent-connection/src/index.ts')!
      .toString();
    expect(index).toContain('my-gateway-client');
  });

  it('adds the gateway client into the agent source file', async () => {
    setupProjects();
    await tsAgentGatewayConnectionGenerator(tree, fullOptions());

    const agent = tree
      .read('packages/my-api/src/my-agent/agent.ts')!
      .toString();
    expect(agent).toContain('MyGatewayClient');
    expect(agent).toContain('agent-connection');
    expect(agent).toContain('MyGatewayClient.create()');
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
    const createCount = (agent.match(/MyGatewayClient\.create/g) ?? []).length;
    expect(createCount).toBe(1);
    const toolsArrayMatches = agent.match(/myGateway/g) ?? [];
    // Expect exactly: declaration + tools reference
    expect(toolsArrayMatches.length).toBeLessThanOrEqual(3);
  });

  it('rejects missing component refs', async () => {
    setupProjects();
    await expect(
      tsAgentGatewayConnectionGenerator(tree, {
        sourceProject: '@test/my-api',
        targetProject: '@test/my-gateway',
      }),
    ).rejects.toThrow(
      /Both sourceComponent and targetComponent must be provided/,
    );
  });

  it('rejects non-MCP gateway protocol', async () => {
    setupProjects();
    await expect(
      tsAgentGatewayConnectionGenerator(tree, {
        ...fullOptions(),
        targetComponent: {
          ...fullOptions().targetComponent,
          protocol: 'Runtime',
        } as any,
      }),
    ).rejects.toThrow(/Only MCP-protocol gateways are supported/);
  });

  it('rejects gateway with non-IAM inbound auth', async () => {
    setupProjects();
    await expect(
      tsAgentGatewayConnectionGenerator(tree, {
        ...fullOptions(),
        targetComponent: {
          ...fullOptions().targetComponent,
          auth: 'Cognito',
        } as any,
      }),
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

  it('exposes stable generator info id', () => {
    expect(TS_AGENT_GATEWAY_CONNECTION_GENERATOR_INFO.id).toBe(
      'ts#agent#gateway-connection',
    );
  });
});
