/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { expectHasMetricTags } from '../../../utils/metrics.spec';
import { sharedConstructsGenerator } from '../../../utils/shared-constructs';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import {
  TS_AGENT_MCP_CONNECTION_GENERATOR_INFO,
  tsAgentMcpConnectionGenerator,
} from './generator';

describe('ts#agent#mcp-connection generator', () => {
  let tree: Tree;

  const setupProjects = () => {
    // Create source project with agent component metadata
    tree.write(
      'packages/my-api/project.json',
      JSON.stringify({
        name: '@test/my-api',
        root: 'packages/my-api',
        sourceRoot: 'packages/my-api/src',
        targets: {
          build: {},
          'my-agent-serve': {
            executor: 'nx:run-commands',
            options: { commands: ['echo serve'] },
            continuous: true,
          },
          'my-agent-dev': {
            executor: 'nx:run-commands',
            options: {
              commands: ['echo dev'],
              env: { PORT: '8081' },
            },
            dependsOn: [],
            continuous: true,
          },
        },
        metadata: {
          components: [
            {
              generator: 'ts#agent',
              name: 'my-agent',
              path: 'src/my-agent',
              port: 8081,
            },
          ],
        },
      }),
    );

    tree.write(
      'packages/my-api/package.json',
      JSON.stringify({
        name: '@test/my-api',
        version: '0.0.0',
        private: true,
        type: 'module',
      }),
    );

    // Create agent.ts
    tree.write(
      'packages/my-api/src/my-agent/agent.ts',
      `
import { Agent, tool } from '@strands-agents/sdk';
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

    // Create target project with MCP server component metadata
    tree.write(
      'packages/my-api/tsconfig.json',
      JSON.stringify({
        compilerOptions: { paths: {} },
      }),
    );

    // Add MCP server component to the same project
    const config = JSON.parse(
      tree.read('packages/my-api/project.json', 'utf-8')!,
    );
    config.metadata.components.push({
      generator: 'ts#mcp-server',
      name: 'inventory-mcp',
      path: 'src/inventory-mcp',
      port: 8082,
      rc: 'InventoryMcp',
    });
    config.targets['inventory-mcp-serve'] = {
      executor: 'nx:run-commands',
      options: { commands: ['echo mcp-serve'] },
      continuous: true,
    };
    tree.write('packages/my-api/project.json', JSON.stringify(config));
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should generate agent-connection project with client', async () => {
    setupProjects();

    await tsAgentMcpConnectionGenerator(tree, {
      sourceProject: '@test/my-api',
      targetProject: '@test/my-api',
      sourceComponent: {
        generator: 'ts#agent',
        name: 'my-agent',
        path: 'src/my-agent',
        port: 8081,
      },
      targetComponent: {
        generator: 'ts#mcp-server',
        name: 'inventory-mcp',
        path: 'src/inventory-mcp',
        port: 8082,
        rc: 'InventoryMcp',
      },
    });

    // Check agent-connection project was created
    expect(tree.exists('packages/common/agent-connection/project.json')).toBe(
      true,
    );

    // Check agentcore-mcp-client-strands.ts was generated in core/
    expect(
      tree.exists(
        'packages/common/agent-connection/src/core/agentcore-mcp-client-strands.ts',
      ),
    ).toBe(true);

    // Check the framework-agnostic transport layer was generated in core/
    expect(
      tree.exists(
        'packages/common/agent-connection/src/core/agentcore-mcp-transport.ts',
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

    // Check per-connection client was generated in app/
    expect(
      tree.exists(
        'packages/common/agent-connection/src/app/inventory-mcp-client-strands.ts',
      ),
    ).toBe(true);

    // Check index.ts has re-export
    const indexContent = tree.read(
      'packages/common/agent-connection/src/index.ts',
      'utf-8',
    );
    expect(indexContent).toContain('inventory-mcp-client-strands');
  });

  it('should transform agent.ts to add MCP client', async () => {
    setupProjects();

    await tsAgentMcpConnectionGenerator(tree, {
      sourceProject: '@test/my-api',
      targetProject: '@test/my-api',
      sourceComponent: {
        generator: 'ts#agent',
        name: 'my-agent',
        path: 'src/my-agent',
        port: 8081,
      },
      targetComponent: {
        generator: 'ts#mcp-server',
        name: 'inventory-mcp',
        path: 'src/inventory-mcp',
        port: 8082,
        rc: 'InventoryMcp',
      },
    });

    const agentContent = tree.read(
      'packages/my-api/src/my-agent/agent.ts',
      'utf-8',
    )!;

    // Check import was added
    expect(agentContent).toContain('InventoryMcpClientStrands');
    expect(agentContent).toContain('agent-connection');

    // Check client creation was added
    expect(agentContent).toContain('InventoryMcpClientStrands.create()');

    // Check client was added to tools array
    expect(agentContent).toContain('inventoryMcp, multiply');
  });

  it('should transform block-body agent.ts to insert client before new Agent', async () => {
    setupProjects();

    // Overwrite agent.ts with a block-body version (already has { ... return ... })
    tree.write(
      'packages/my-api/src/my-agent/agent.ts',
      `
import { Agent, tool } from '@strands-agents/sdk';
import { z } from 'zod';

const multiply = tool({
  name: 'Multiply',
  description: 'Multiply two numbers',
  inputSchema: z.object({ a: z.number(), b: z.number() }),
  callback: ({ a, b }) => a * b,
});

export const getAgent = async (sessionId: string) => {
  console.log('Creating agent');
  return new Agent({
    systemPrompt: 'You are a mathematical wizard.',
    tools: [multiply],
  });
};
`,
    );

    await tsAgentMcpConnectionGenerator(tree, {
      sourceProject: '@test/my-api',
      targetProject: '@test/my-api',
      sourceComponent: {
        generator: 'ts#agent',
        name: 'my-agent',
        path: 'src/my-agent',
        port: 8081,
      },
      targetComponent: {
        generator: 'ts#mcp-server',
        name: 'inventory-mcp',
        path: 'src/inventory-mcp',
        port: 8082,
        rc: 'InventoryMcp',
      },
    });

    const agentContent = tree.read(
      'packages/my-api/src/my-agent/agent.ts',
      'utf-8',
    )!;

    // Check client creation was inserted before new Agent
    expect(agentContent).toContain('InventoryMcpClientStrands.create()');
    expect(agentContent).toContain('inventoryMcp, multiply');

    // Verify the console.log is still present (block body preserved)
    expect(agentContent).toContain("console.log('Creating agent')");

    // Verify client creation comes before new Agent
    const clientIndex = agentContent.indexOf(
      'InventoryMcpClientStrands.create',
    );
    const agentIndex = agentContent.indexOf('new Agent(');
    expect(clientIndex).toBeLessThan(agentIndex);
  });

  it('should update dev target with MCP dependency', async () => {
    setupProjects();

    await tsAgentMcpConnectionGenerator(tree, {
      sourceProject: '@test/my-api',
      targetProject: '@test/my-api',
      sourceComponent: {
        generator: 'ts#agent',
        name: 'my-agent',
        path: 'src/my-agent',
        port: 8081,
      },
      targetComponent: {
        generator: 'ts#mcp-server',
        name: 'inventory-mcp',
        path: 'src/inventory-mcp',
        port: 8082,
        rc: 'InventoryMcp',
      },
    });

    const config = JSON.parse(
      tree.read('packages/my-api/project.json', 'utf-8')!,
    );
    const devTarget = config.targets['my-agent-dev'];

    // Check dependency was added
    expect(devTarget.dependsOn).toContainEqual({
      projects: ['@test/my-api'],
      target: 'inventory-mcp-dev',
    });

    // LOCAL_DEV env var is set by the agent generator's dev target, not the connection generator
  });

  it('should not duplicate imports on second run', async () => {
    setupProjects();

    const opts = {
      sourceProject: '@test/my-api',
      targetProject: '@test/my-api',
      sourceComponent: {
        generator: 'ts#agent',
        name: 'my-agent',
        path: 'src/my-agent',
        port: 8081,
      },
      targetComponent: {
        generator: 'ts#mcp-server',
        name: 'inventory-mcp',
        path: 'src/inventory-mcp',
        port: 8082,
        rc: 'InventoryMcp',
      },
    };

    await tsAgentMcpConnectionGenerator(tree, opts);
    await tsAgentMcpConnectionGenerator(tree, opts);

    const agentContent = tree.read(
      'packages/my-api/src/my-agent/agent.ts',
      'utf-8',
    )!;

    // Should only have one import
    const importCount = (agentContent.match(/InventoryMcpClientStrands/g) || [])
      .length;
    // Import + create + listToolsSync = 3 occurrences, not more
    expect(importCount).toBeLessThanOrEqual(4);
  });

  it('should not duplicate import when connecting two different MCP servers to same agent', async () => {
    setupProjects();

    // First connection: inventory-mcp
    await tsAgentMcpConnectionGenerator(tree, {
      sourceProject: '@test/my-api',
      targetProject: '@test/my-api',
      sourceComponent: {
        generator: 'ts#agent',
        name: 'my-agent',
        path: 'src/my-agent',
        port: 8081,
      },
      targetComponent: {
        generator: 'ts#mcp-server',
        name: 'inventory-mcp',
        path: 'src/inventory-mcp',
        port: 8082,
        rc: 'InventoryMcp',
      },
    });

    // Second connection: catalog-mcp (different MCP server)
    await tsAgentMcpConnectionGenerator(tree, {
      sourceProject: '@test/my-api',
      targetProject: '@test/my-api',
      sourceComponent: {
        generator: 'ts#agent',
        name: 'my-agent',
        path: 'src/my-agent',
        port: 8081,
      },
      targetComponent: {
        generator: 'ts#mcp-server',
        name: 'catalog-mcp',
        path: 'src/catalog-mcp',
        port: 8083,
        rc: 'CatalogMcp',
      },
    });

    const agentContent = tree.read(
      'packages/my-api/src/my-agent/agent.ts',
      'utf-8',
    )!;

    // Should have exactly one import statement from agent-connection
    const importSourceCount = (
      agentContent.match(/from '@proj\/agent-connection'/g) ?? []
    ).length;
    expect(importSourceCount).toBe(1);

    // That single import should bring in both clients
    expect(agentContent).toContain('InventoryMcpClientStrands');
    expect(agentContent).toContain('CatalogMcpClientStrands');

    // Both clients should be in the tools array
    expect(agentContent).toContain('catalogMcp');
    expect(agentContent).toContain('inventoryMcp');
  });

  it('should throw if components are not provided', async () => {
    setupProjects();

    await expect(
      tsAgentMcpConnectionGenerator(tree, {
        sourceProject: '@test/my-api',
        targetProject: '@test/my-api',
      }),
    ).rejects.toThrow('sourceComponent and targetComponent must be provided');
  });

  it('should add generator metric to app.ts', async () => {
    setupProjects();
    await sharedConstructsGenerator(tree, { iac: 'cdk' });

    await tsAgentMcpConnectionGenerator(tree, {
      sourceProject: '@test/my-api',
      targetProject: '@test/my-api',
      sourceComponent: {
        generator: 'ts#agent',
        name: 'my-agent',
        path: 'src/my-agent',
        port: 8081,
      },
      targetComponent: {
        generator: 'ts#mcp-server',
        name: 'inventory-mcp',
        path: 'src/inventory-mcp',
        port: 8082,
        rc: 'InventoryMcp',
      },
    });

    expectHasMetricTags(tree, TS_AGENT_MCP_CONNECTION_GENERATOR_INFO.metric);
  });

  it('should match snapshot for agent-connection src files', async () => {
    setupProjects();

    await tsAgentMcpConnectionGenerator(tree, {
      sourceProject: '@test/my-api',
      targetProject: '@test/my-api',
      sourceComponent: {
        generator: 'ts#agent',
        name: 'my-agent',
        path: 'src/my-agent',
        port: 8081,
      },
      targetComponent: {
        generator: 'ts#mcp-server',
        name: 'inventory-mcp',
        path: 'src/inventory-mcp',
        port: 8082,
        rc: 'InventoryMcp',
      },
    });

    const agentCoreMcpClientStrands = tree.read(
      'packages/common/agent-connection/src/core/agentcore-mcp-client-strands.ts',
      'utf-8',
    );
    expect(agentCoreMcpClientStrands).toMatchSnapshot(
      'agentcore-mcp-client-strands.ts',
    );

    const agentCoreMcpTransport = tree.read(
      'packages/common/agent-connection/src/core/agentcore-mcp-transport.ts',
      'utf-8',
    );
    expect(agentCoreMcpTransport).toMatchSnapshot('agentcore-mcp-transport.ts');

    const agentCoreTransport = tree.read(
      'packages/common/agent-connection/src/core/agentcore-transport.ts',
      'utf-8',
    );
    expect(agentCoreTransport).toMatchSnapshot('agentcore-transport.ts');

    const agentCoreFetch = tree.read(
      'packages/common/agent-connection/src/core/agentcore-fetch.ts',
      'utf-8',
    );
    expect(agentCoreFetch).toMatchSnapshot('agentcore-fetch.ts');

    const inventoryMcpClient = tree.read(
      'packages/common/agent-connection/src/app/inventory-mcp-client-strands.ts',
      'utf-8',
    );
    expect(inventoryMcpClient).toMatchSnapshot(
      'inventory-mcp-client-strands.ts',
    );

    const indexTs = tree.read(
      'packages/common/agent-connection/src/index.ts',
      'utf-8',
    );
    expect(indexTs).toMatchSnapshot('agent-connection-index.ts');

    const agentTs = tree.read('packages/my-api/src/my-agent/agent.ts', 'utf-8');
    expect(agentTs).toMatchSnapshot('transformed-agent.ts');
  });
});
