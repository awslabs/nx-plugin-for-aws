/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import {
  pyStrandsAgentMcpConnectionGenerator,
  PY_STRANDS_AGENT_MCP_CONNECTION_GENERATOR_INFO,
} from './generator';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import { expectHasMetricTags } from '../../../utils/metrics.spec';
import { sharedConstructsGenerator } from '../../../utils/shared-constructs';

describe('py#strands-agent#mcp-connection generator', () => {
  let tree: Tree;

  const setupProjects = () => {
    // Create source python project with agent component metadata
    tree.write(
      'packages/my-agent/project.json',
      JSON.stringify({
        name: 'my_scope.my_agent',
        root: 'packages/my-agent',
        sourceRoot: 'packages/my-agent/my_scope_my_agent',
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
              env: { SERVE_LOCAL: 'true' },
            },
            dependsOn: [],
            continuous: true,
          },
        },
        metadata: {
          components: [
            {
              generator: 'py#strands-agent',
              name: 'my-agent',
              path: 'my_scope_my_agent/agent',
              port: 8081,
              rc: 'MyAgent',
            },
          ],
        },
      }),
    );

    // Create agent.py
    tree.write(
      'packages/my-agent/my_scope_my_agent/agent/agent.py',
      `from contextlib import contextmanager

from strands import Agent, tool
from strands_tools import current_time


# Define a custom tool
@tool
def subtract(a: int, b: int) -> int:
    return a - b


@contextmanager
def get_agent(session_id: str):
    yield Agent(
        system_prompt="""
You are a mathematical wizard.
Use your tools for mathematical tasks.
Refer to tools as your 'spellbook'.
""",
        tools=[subtract, current_time],
    )
`,
    );

    // Create pyproject.toml
    tree.write(
      'packages/my-agent/pyproject.toml',
      `[project]
name = "my_scope.my_agent"
version = "1.0.0"
dependencies = ["strands-agents"]
`,
    );

    // Create target project with MCP server component metadata
    tree.write(
      'packages/my-api/project.json',
      JSON.stringify({
        name: '@test/my-api',
        root: 'packages/my-api',
        sourceRoot: 'packages/my-api/src',
        targets: {
          build: {},
          'inventory-mcp-serve-local': {
            executor: 'nx:run-commands',
            options: { commands: ['echo mcp-serve'] },
            continuous: true,
          },
        },
        metadata: {
          components: [
            {
              generator: 'ts#mcp-server',
              name: 'inventory-mcp',
              path: 'src/inventory-mcp',
              port: 8082,
              rc: 'InventoryMcp',
            },
          ],
        },
      }),
    );
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should create shared agent-connection project with per-connection client', async () => {
    setupProjects();

    await pyStrandsAgentMcpConnectionGenerator(tree, {
      sourceProject: 'my_scope.my_agent',
      targetProject: '@test/my-api',
      sourceComponent: {
        generator: 'py#strands-agent',
        name: 'my-agent',
        path: 'my_scope_my_agent/agent',
        port: 8081,
        rc: 'MyAgent',
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
    expect(tree.exists('packages/common/agent_connection/project.json')).toBe(
      true,
    );

    // Check core agentcore_mcp_client.py was generated
    expect(
      tree.exists(
        'packages/common/agent_connection/proj_agent_connection/core/agentcore_mcp_client.py',
      ),
    ).toBe(true);

    // Check per-connection client was generated in the shared project
    expect(
      tree.exists(
        'packages/common/agent_connection/proj_agent_connection/app/inventory_mcp_client.py',
      ),
    ).toBe(true);

    // Check re-export in __init__.py
    const initContent = tree.read(
      'packages/common/agent_connection/proj_agent_connection/__init__.py',
      'utf-8',
    );
    expect(initContent).toContain(
      'from .app.inventory_mcp_client import InventoryMcpClient',
    );
  });

  it('should transform agent.py to add MCP client', async () => {
    setupProjects();

    await pyStrandsAgentMcpConnectionGenerator(tree, {
      sourceProject: 'my_scope.my_agent',
      targetProject: '@test/my-api',
      sourceComponent: {
        generator: 'py#strands-agent',
        name: 'my-agent',
        path: 'my_scope_my_agent/agent',
        port: 8081,
        rc: 'MyAgent',
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
      'packages/my-agent/my_scope_my_agent/agent/agent.py',
      'utf-8',
    )!;

    // Check import was added using the shared module
    expect(agentContent).toContain('InventoryMcpClient');
    expect(agentContent).toContain(
      'from proj_agent_connection import InventoryMcpClient',
    );

    // Check named client creation (matching TS pattern)
    expect(agentContent).toContain(
      'inventory_mcp = InventoryMcpClient.create(session_id=session_id)',
    );

    // Check parenthesized with block was added
    expect(agentContent).toContain('inventory_mcp,');

    // Check tools were updated with named variable
    expect(agentContent).toContain('*inventory_mcp.list_tools_sync()');
  });

  it('should add workspace dependency to agent pyproject.toml', async () => {
    setupProjects();

    await pyStrandsAgentMcpConnectionGenerator(tree, {
      sourceProject: 'my_scope.my_agent',
      targetProject: '@test/my-api',
      sourceComponent: {
        generator: 'py#strands-agent',
        name: 'my-agent',
        path: 'my_scope_my_agent/agent',
        port: 8081,
        rc: 'MyAgent',
      },
      targetComponent: {
        generator: 'ts#mcp-server',
        name: 'inventory-mcp',
        path: 'src/inventory-mcp',
        port: 8082,
        rc: 'InventoryMcp',
      },
    });

    const pyprojectContent = tree.read(
      'packages/my-agent/pyproject.toml',
      'utf-8',
    )!;

    // Check workspace dependency was added
    expect(pyprojectContent).toContain('proj.agent_connection');
  });

  it('should update serve-local target with MCP dependency', async () => {
    setupProjects();

    await pyStrandsAgentMcpConnectionGenerator(tree, {
      sourceProject: 'my_scope.my_agent',
      targetProject: '@test/my-api',
      sourceComponent: {
        generator: 'py#strands-agent',
        name: 'my-agent',
        path: 'my_scope_my_agent/agent',
        port: 8081,
        rc: 'MyAgent',
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
      tree.read('packages/my-agent/project.json', 'utf-8')!,
    );
    const serveLocal = config.targets['my-agent-serve-local'];

    expect(serveLocal.dependsOn).toContainEqual({
      projects: ['@test/my-api'],
      target: 'inventory-mcp-serve-local',
    });
  });

  it('should not duplicate imports on second run', async () => {
    setupProjects();

    const opts = {
      sourceProject: 'my_scope.my_agent',
      targetProject: '@test/my-api',
      sourceComponent: {
        generator: 'py#strands-agent',
        name: 'my-agent',
        path: 'my_scope_my_agent/agent',
        port: 8081,
        rc: 'MyAgent',
      },
      targetComponent: {
        generator: 'ts#mcp-server',
        name: 'inventory-mcp',
        path: 'src/inventory-mcp',
        port: 8082,
        rc: 'InventoryMcp',
      },
    };

    await pyStrandsAgentMcpConnectionGenerator(tree, opts);
    await pyStrandsAgentMcpConnectionGenerator(tree, opts);

    const agentContent = tree.read(
      'packages/my-agent/my_scope_my_agent/agent/agent.py',
      'utf-8',
    )!;

    // Should only have one import and one client creation
    const importCount = (agentContent.match(/InventoryMcpClient/g) || [])
      .length;
    // Import + creation = 2 occurrences, not more
    expect(importCount).toBeLessThanOrEqual(2);

    // Should only have one with block
    const withCount = (agentContent.match(/with\s*\(/g) || []).length;
    expect(withCount).toBe(1);
  });

  it('should handle connecting two different MCP servers to the same agent', async () => {
    setupProjects();

    // First connection: inventory-mcp
    await pyStrandsAgentMcpConnectionGenerator(tree, {
      sourceProject: 'my_scope.my_agent',
      targetProject: '@test/my-api',
      sourceComponent: {
        generator: 'py#strands-agent',
        name: 'my-agent',
        path: 'my_scope_my_agent/agent',
        port: 8081,
        rc: 'MyAgent',
      },
      targetComponent: {
        generator: 'ts#mcp-server',
        name: 'inventory-mcp',
        path: 'src/inventory-mcp',
        port: 8082,
        rc: 'InventoryMcp',
      },
    });

    // Add second MCP server component
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

    // Second connection: catalog-mcp
    await pyStrandsAgentMcpConnectionGenerator(tree, {
      sourceProject: 'my_scope.my_agent',
      targetProject: '@test/my-api',
      sourceComponent: {
        generator: 'py#strands-agent',
        name: 'my-agent',
        path: 'my_scope_my_agent/agent',
        port: 8081,
        rc: 'MyAgent',
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
      'packages/my-agent/my_scope_my_agent/agent/agent.py',
      'utf-8',
    )!;

    // Both imports should be present
    expect(agentContent).toContain('InventoryMcpClient');
    expect(agentContent).toContain('CatalogMcpClient');

    // Both named variables should be present
    expect(agentContent).toContain('inventory_mcp = InventoryMcpClient.create');
    expect(agentContent).toContain('catalog_mcp = CatalogMcpClient.create');

    // Should use parenthesized multi-with syntax (not nested)
    expect(agentContent).toContain('inventory_mcp,');
    expect(agentContent).toContain('catalog_mcp,');
    // Only one with block
    expect((agentContent.match(/with\s*\(/g) || []).length).toBe(1);

    // Both tools should be in the tools array
    expect(agentContent).toContain('*inventory_mcp.list_tools_sync()');
    expect(agentContent).toContain('*catalog_mcp.list_tools_sync()');

    // Both client files should exist in the shared project
    expect(
      tree.exists(
        'packages/common/agent_connection/proj_agent_connection/app/inventory_mcp_client.py',
      ),
    ).toBe(true);
    expect(
      tree.exists(
        'packages/common/agent_connection/proj_agent_connection/app/catalog_mcp_client.py',
      ),
    ).toBe(true);

    // Both re-exports should be in __init__.py
    const initContent = tree.read(
      'packages/common/agent_connection/proj_agent_connection/__init__.py',
      'utf-8',
    );
    expect(initContent).toContain('InventoryMcpClient');
    expect(initContent).toContain('CatalogMcpClient');
  });

  it('should throw if components are not provided', async () => {
    setupProjects();

    await expect(
      pyStrandsAgentMcpConnectionGenerator(tree, {
        sourceProject: 'my_scope.my_agent',
        targetProject: '@test/my-api',
      }),
    ).rejects.toThrow('sourceComponent and targetComponent must be provided');
  });

  it('should add generator metric to app.ts', async () => {
    setupProjects();
    await sharedConstructsGenerator(tree, { iacProvider: 'CDK' });

    await pyStrandsAgentMcpConnectionGenerator(tree, {
      sourceProject: 'my_scope.my_agent',
      targetProject: '@test/my-api',
      sourceComponent: {
        generator: 'py#strands-agent',
        name: 'my-agent',
        path: 'my_scope_my_agent/agent',
        port: 8081,
        rc: 'MyAgent',
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
      PY_STRANDS_AGENT_MCP_CONNECTION_GENERATOR_INFO.metric,
    );
  });

  it('should match snapshot for generated files', async () => {
    setupProjects();

    await pyStrandsAgentMcpConnectionGenerator(tree, {
      sourceProject: 'my_scope.my_agent',
      targetProject: '@test/my-api',
      sourceComponent: {
        generator: 'py#strands-agent',
        name: 'my-agent',
        path: 'my_scope_my_agent/agent',
        port: 8081,
        rc: 'MyAgent',
      },
      targetComponent: {
        generator: 'ts#mcp-server',
        name: 'inventory-mcp',
        path: 'src/inventory-mcp',
        port: 8082,
        rc: 'InventoryMcp',
      },
    });

    const clientFile = tree.read(
      'packages/common/agent_connection/proj_agent_connection/app/inventory_mcp_client.py',
      'utf-8',
    );
    expect(clientFile).toMatchSnapshot('inventory_mcp_client.py');

    const agentCoreMcpClient = tree.read(
      'packages/common/agent_connection/proj_agent_connection/core/agentcore_mcp_client.py',
      'utf-8',
    );
    expect(agentCoreMcpClient).toMatchSnapshot('agentcore_mcp_client.py');

    const initPy = tree.read(
      'packages/common/agent_connection/proj_agent_connection/__init__.py',
      'utf-8',
    );
    expect(initPy).toMatchSnapshot('agent-connection-init.py');

    const agentPy = tree.read(
      'packages/my-agent/my_scope_my_agent/agent/agent.py',
      'utf-8',
    );
    expect(agentPy).toMatchSnapshot('transformed-agent.py');
  });
});
