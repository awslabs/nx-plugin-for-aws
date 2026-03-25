/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import {
  tsStrandsAgentMcpConnectionGenerator,
  TS_STRANDS_AGENT_MCP_CONNECTION_GENERATOR_INFO,
} from './generator';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import { expectHasMetricTags } from '../../../utils/metrics.spec';
import { sharedConstructsGenerator } from '../../../utils/shared-constructs';

describe('ts#strands-agent#mcp-connection generator', () => {
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
          'my-agent-serve-local': {
            executor: 'nx:run-commands',
            options: {
              commands: ['echo serve-local'],
              env: { PORT: '8081' },
            },
            dependsOn: [],
            continuous: true,
          },
        },
        metadata: {
          components: [
            {
              generator: 'ts#strands-agent',
              name: 'my-agent',
              path: 'src/my-agent',
              port: 8081,
            },
          ],
        },
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

    await tsStrandsAgentMcpConnectionGenerator(tree, {
      sourceProject: '@test/my-api',
      targetProject: '@test/my-api',
      sourceComponent: {
        generator: 'ts#strands-agent',
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

    // Check agentcore-mcp-client.ts was generated in core/
    expect(
      tree.exists(
        'packages/common/agent-connection/src/core/agentcore-mcp-client.ts',
      ),
    ).toBe(true);

    // Check per-connection client was generated in app/
    expect(
      tree.exists(
        'packages/common/agent-connection/src/app/inventory-mcp-client.ts',
      ),
    ).toBe(true);

    // Check index.ts has re-export
    const indexContent = tree.read(
      'packages/common/agent-connection/src/index.ts',
      'utf-8',
    );
    expect(indexContent).toContain('inventory-mcp-client');
  });

  it('should transform agent.ts to add MCP client', async () => {
    setupProjects();

    await tsStrandsAgentMcpConnectionGenerator(tree, {
      sourceProject: '@test/my-api',
      targetProject: '@test/my-api',
      sourceComponent: {
        generator: 'ts#strands-agent',
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
    expect(agentContent).toContain('InventoryMcpClient');
    expect(agentContent).toContain('agent-connection');

    // Check client creation was added
    expect(agentContent).toContain('InventoryMcpClient.create(sessionId)');

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

    await tsStrandsAgentMcpConnectionGenerator(tree, {
      sourceProject: '@test/my-api',
      targetProject: '@test/my-api',
      sourceComponent: {
        generator: 'ts#strands-agent',
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
    expect(agentContent).toContain('InventoryMcpClient.create(sessionId)');
    expect(agentContent).toContain('inventoryMcp, multiply');

    // Verify the console.log is still present (block body preserved)
    expect(agentContent).toContain("console.log('Creating agent')");

    // Verify client creation comes before new Agent
    const clientIndex = agentContent.indexOf('InventoryMcpClient.create');
    const agentIndex = agentContent.indexOf('new Agent(');
    expect(clientIndex).toBeLessThan(agentIndex);
  });

  it('should update serve-local target with MCP dependency', async () => {
    setupProjects();

    await tsStrandsAgentMcpConnectionGenerator(tree, {
      sourceProject: '@test/my-api',
      targetProject: '@test/my-api',
      sourceComponent: {
        generator: 'ts#strands-agent',
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
    const serveLocal = config.targets['my-agent-serve-local'];

    // Check dependency was added
    expect(serveLocal.dependsOn).toContainEqual({
      projects: ['@test/my-api'],
      target: 'inventory-mcp-serve-local',
    });

    // SERVE_LOCAL env var is set by the agent generator's serve-local target, not the connection generator
  });

  it('should not duplicate imports on second run', async () => {
    setupProjects();

    const opts = {
      sourceProject: '@test/my-api',
      targetProject: '@test/my-api',
      sourceComponent: {
        generator: 'ts#strands-agent',
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

    await tsStrandsAgentMcpConnectionGenerator(tree, opts);
    await tsStrandsAgentMcpConnectionGenerator(tree, opts);

    const agentContent = tree.read(
      'packages/my-api/src/my-agent/agent.ts',
      'utf-8',
    )!;

    // Should only have one import
    const importCount = (agentContent.match(/InventoryMcpClient/g) || [])
      .length;
    // Import + create + listToolsSync = 3 occurrences, not more
    expect(importCount).toBeLessThanOrEqual(4);
  });

  it('should not duplicate import when connecting two different MCP servers to same agent', async () => {
    setupProjects();

    // First connection: inventory-mcp
    await tsStrandsAgentMcpConnectionGenerator(tree, {
      sourceProject: '@test/my-api',
      targetProject: '@test/my-api',
      sourceComponent: {
        generator: 'ts#strands-agent',
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
    await tsStrandsAgentMcpConnectionGenerator(tree, {
      sourceProject: '@test/my-api',
      targetProject: '@test/my-api',
      sourceComponent: {
        generator: 'ts#strands-agent',
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

    // Should have exactly one import from agent-connection (with both clients)
    const importLines = agentContent
      .split('\n')
      .filter((l) => l.includes('agent-connection'));
    expect(importLines).toHaveLength(1);

    // The single import should contain both clients
    expect(importLines[0]).toContain('InventoryMcpClient');
    expect(importLines[0]).toContain('CatalogMcpClient');

    // Both clients should be in the tools array
    expect(agentContent).toContain('catalogMcp');
    expect(agentContent).toContain('inventoryMcp');
  });

  it('should throw if components are not provided', async () => {
    setupProjects();

    await expect(
      tsStrandsAgentMcpConnectionGenerator(tree, {
        sourceProject: '@test/my-api',
        targetProject: '@test/my-api',
      }),
    ).rejects.toThrow('sourceComponent and targetComponent must be provided');
  });

  it('should add generator metric to app.ts', async () => {
    setupProjects();
    await sharedConstructsGenerator(tree, { iacProvider: 'CDK' });

    await tsStrandsAgentMcpConnectionGenerator(tree, {
      sourceProject: '@test/my-api',
      targetProject: '@test/my-api',
      sourceComponent: {
        generator: 'ts#strands-agent',
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

    expectHasMetricTags(
      tree,
      TS_STRANDS_AGENT_MCP_CONNECTION_GENERATOR_INFO.metric,
    );
  });

  it('should match snapshot for agent-connection src files', async () => {
    setupProjects();

    await tsStrandsAgentMcpConnectionGenerator(tree, {
      sourceProject: '@test/my-api',
      targetProject: '@test/my-api',
      sourceComponent: {
        generator: 'ts#strands-agent',
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

    const agentCoreMcpClient = tree.read(
      'packages/common/agent-connection/src/core/agentcore-mcp-client.ts',
      'utf-8',
    );
    expect(agentCoreMcpClient).toMatchSnapshot('agentcore-mcp-client.ts');

    const inventoryMcpClient = tree.read(
      'packages/common/agent-connection/src/app/inventory-mcp-client.ts',
      'utf-8',
    );
    expect(inventoryMcpClient).toMatchSnapshot('inventory-mcp-client.ts');

    const indexTs = tree.read(
      'packages/common/agent-connection/src/index.ts',
      'utf-8',
    );
    expect(indexTs).toMatchSnapshot('agent-connection-index.ts');

    const agentTs = tree.read('packages/my-api/src/my-agent/agent.ts', 'utf-8');
    expect(agentTs).toMatchSnapshot('transformed-agent.ts');
  });

  describe('Cognito auth', () => {
    it('should generate Cognito JWT auth client when target has auth=Cognito', async () => {
      setupProjects();

      await tsStrandsAgentMcpConnectionGenerator(tree, {
        sourceProject: '@test/my-api',
        targetProject: '@test/my-api',
        sourceComponent: {
          generator: 'ts#strands-agent',
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
          auth: 'Cognito',
        },
      });

      // Check per-connection client uses JWT auth
      const clientContent = tree.read(
        'packages/common/agent-connection/src/app/inventory-mcp-client.ts',
        'utf-8',
      )!;
      expect(clientContent).toContain('AgentCoreIdentityTokenProvider');
      expect(clientContent).toContain('withJwtAuth');
      expect(clientContent).toContain('workloadAccessToken');
      expect(clientContent).not.toContain('withIamAuth');

      // Check AgentCore Identity token provider was generated
      expect(
        tree.exists(
          'packages/common/agent-connection/src/core/agentcore-identity-token-provider.ts',
        ),
      ).toBe(true);

      // Check index.ts re-exports the identity module
      const coreIndexContent = tree.read(
        'packages/common/agent-connection/src/core/index.ts',
        'utf-8',
      );
      expect(coreIndexContent).toContain(
        'agentcore-identity-token-provider',
      );
    });

    it('should pass workloadAccessToken in agent.ts AST transform for Cognito auth', async () => {
      setupProjects();

      await tsStrandsAgentMcpConnectionGenerator(tree, {
        sourceProject: '@test/my-api',
        targetProject: '@test/my-api',
        sourceComponent: {
          generator: 'ts#strands-agent',
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
          auth: 'Cognito',
        },
      });

      const agentContent = tree.read(
        'packages/my-api/src/my-agent/agent.ts',
        'utf-8',
      )!;

      // Check create() is called with both sessionId and workloadAccessToken
      expect(agentContent).toContain('InventoryMcpClient.create(');
      expect(agentContent).toContain('workloadAccessToken');
    });

    it('should add @aws-sdk/client-bedrock-agentcore dependency for Cognito auth', async () => {
      setupProjects();

      await tsStrandsAgentMcpConnectionGenerator(tree, {
        sourceProject: '@test/my-api',
        targetProject: '@test/my-api',
        sourceComponent: {
          generator: 'ts#strands-agent',
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
          auth: 'Cognito',
        },
      });

      const packageJson = JSON.parse(
        tree.read('package.json', 'utf-8')!,
      );
      expect(
        packageJson.dependencies['@aws-sdk/client-bedrock-agentcore'],
      ).toBeDefined();
      // Should NOT have IAM-specific deps
      expect(packageJson.dependencies['aws4fetch']).toBeUndefined();
    });

    it('should handle mixed auth connections (IAM + Cognito to same agent)', async () => {
      setupProjects();

      // Add a second MCP server component
      const config = JSON.parse(
        tree.read('packages/my-api/project.json', 'utf-8')!,
      );
      config.metadata.components.push({
        generator: 'ts#mcp-server',
        name: 'catalog-mcp',
        path: 'src/catalog-mcp',
        port: 8083,
        rc: 'CatalogMcp',
      });
      tree.write('packages/my-api/project.json', JSON.stringify(config));

      // First connection: Cognito auth
      await tsStrandsAgentMcpConnectionGenerator(tree, {
        sourceProject: '@test/my-api',
        targetProject: '@test/my-api',
        sourceComponent: {
          generator: 'ts#strands-agent',
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
          auth: 'Cognito',
        },
      });

      // Second connection: IAM auth (default)
      await tsStrandsAgentMcpConnectionGenerator(tree, {
        sourceProject: '@test/my-api',
        targetProject: '@test/my-api',
        sourceComponent: {
          generator: 'ts#strands-agent',
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

      // Check both clients were generated
      const inventoryClient = tree.read(
        'packages/common/agent-connection/src/app/inventory-mcp-client.ts',
        'utf-8',
      )!;
      expect(inventoryClient).toContain('withJwtAuth');

      const catalogClient = tree.read(
        'packages/common/agent-connection/src/app/catalog-mcp-client.ts',
        'utf-8',
      )!;
      expect(catalogClient).toContain('withIamAuth');

      // Agent should have both clients
      const agentContent = tree.read(
        'packages/my-api/src/my-agent/agent.ts',
        'utf-8',
      )!;
      expect(agentContent).toContain('inventoryMcp');
      expect(agentContent).toContain('catalogMcp');
    });

    it('should match snapshot for Cognito auth client', async () => {
      setupProjects();

      await tsStrandsAgentMcpConnectionGenerator(tree, {
        sourceProject: '@test/my-api',
        targetProject: '@test/my-api',
        sourceComponent: {
          generator: 'ts#strands-agent',
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
          auth: 'Cognito',
        },
      });

      const inventoryMcpClient = tree.read(
        'packages/common/agent-connection/src/app/inventory-mcp-client.ts',
        'utf-8',
      );
      expect(inventoryMcpClient).toMatchSnapshot(
        'inventory-mcp-client-cognito.ts',
      );

      const tokenProvider = tree.read(
        'packages/common/agent-connection/src/core/agentcore-identity-token-provider.ts',
        'utf-8',
      );
      expect(tokenProvider).toMatchSnapshot(
        'agentcore-identity-token-provider.ts',
      );

      const agentTs = tree.read(
        'packages/my-api/src/my-agent/agent.ts',
        'utf-8',
      );
      expect(agentTs).toMatchSnapshot('transformed-agent-cognito.ts');
    });
  });
});
