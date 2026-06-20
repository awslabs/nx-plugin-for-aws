/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import {
  PY_AGENT_GATEWAY_CONNECTION_GENERATOR_INFO,
  pyAgentGatewayConnectionGenerator,
} from './generator';

describe('py#agent#gateway-connection generator', () => {
  let tree: Tree;

  const setupProjects = () => {
    tree.write(
      'packages/my-agent/project.json',
      JSON.stringify({
        name: 'my_scope.my_agent',
        root: 'packages/my-agent',
        sourceRoot: 'packages/my-agent/my_scope_my_agent',
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
      'packages/my-agent/my_scope_my_agent/agent/agent.py',
      `from contextlib import contextmanager

from strands import Agent, tool
from strands_tools import current_time


@tool
def subtract(a: int, b: int) -> int:
    return a - b


@contextmanager
def get_agent(session_id: str):
    yield Agent(
        system_prompt="You are a mathematical wizard.",
        tools=[subtract, current_time],
    )
`,
    );
    tree.write(
      'packages/my-agent/pyproject.toml',
      `[project]
name = "my_scope.my_agent"
version = "1.0.0"
dependencies = ["strands-agents"]
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
    sourceProject: 'my_scope.my_agent',
    targetProject: '@test/my-gateway',
    sourceComponent: {
      generator: 'py#agent',
      name: 'my-agent',
      path: 'my_scope_my_agent/agent',
      port: 8081,
      rc: 'MyAgent',
      auth: 'iam',
    } as any,
  });

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('scaffolds the Python agent-connection project and gateway client', async () => {
    setupProjects();
    await pyAgentGatewayConnectionGenerator(tree, fullOptions());

    // Project shell
    expect(tree.exists('packages/common/agent_connection/project.json')).toBe(
      true,
    );
    // Shared SigV4 auth + gateway core clients
    const moduleDirs = tree.children('packages/common/agent_connection');
    const moduleName = moduleDirs.find((c) => c.includes('agent_connection'))!;
    expect(
      tree.exists(
        `packages/common/agent_connection/${moduleName}/core/auth/sigv4.py`,
      ),
    ).toBe(true);
    expect(
      tree.exists(
        `packages/common/agent_connection/${moduleName}/core/agentcore_gateway_mcp_client.py`,
      ),
    ).toBe(true);
    // Framework-agnostic transport layer shared with the MCP client
    expect(
      tree.exists(
        `packages/common/agent_connection/${moduleName}/core/agentcore_gateway_mcp_transport.py`,
      ),
    ).toBe(true);
    expect(
      tree.exists(
        `packages/common/agent_connection/${moduleName}/core/agentcore_transport.py`,
      ),
    ).toBe(true);
    expect(
      tree.exists(
        `packages/common/agent_connection/${moduleName}/core/auth/session.py`,
      ),
    ).toBe(true);
    // Per-connection app client
    expect(
      tree.exists(
        `packages/common/agent_connection/${moduleName}/app/my_gateway_client.py`,
      ),
    ).toBe(true);
  });

  it('emits a per-connection client with the gateway class name', async () => {
    setupProjects();
    await pyAgentGatewayConnectionGenerator(tree, fullOptions());

    const moduleDirs = tree.children('packages/common/agent_connection');
    const moduleName = moduleDirs.find((c) => c.includes('agent_connection'))!;
    const client = tree
      .read(
        `packages/common/agent_connection/${moduleName}/app/my_gateway_client.py`,
      )!
      .toString();
    expect(client).toContain('class MyGatewayClient');
    expect(client).toContain('config.get("gateways", {}).get("MyGateway")');
    expect(client).toContain('SERVE_LOCAL');
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
    await pyAgentGatewayConnectionGenerator(tree, fullOptions());

    const moduleDirs = tree.children('packages/common/agent_connection');
    const moduleName = moduleDirs.find((c) => c.includes('agent_connection'))!;
    const client = tree
      .read(
        `packages/common/agent_connection/${moduleName}/app/my_gateway_client.py`,
      )!
      .toString();
    expect(client).toContain('gateway_url="http://localhost:8123/mcp"');
    expect(client).toContain('without_auth');
  });

  it('exposes the shared get_agentcore_runtime_config helper', async () => {
    setupProjects();
    await pyAgentGatewayConnectionGenerator(tree, fullOptions());

    const moduleDirs = tree.children('packages/common/agent_connection');
    const moduleName = moduleDirs.find((c) => c.includes('agent_connection'))!;
    const runtimeConfig = tree
      .read(
        `packages/common/agent_connection/${moduleName}/core/runtime_config.py`,
      )!
      .toString();
    expect(runtimeConfig).toContain('def get_agentcore_runtime_config');
  });

  it('re-exports from the module __init__.py', async () => {
    setupProjects();
    await pyAgentGatewayConnectionGenerator(tree, fullOptions());

    const moduleDirs = tree.children('packages/common/agent_connection');
    const moduleName = moduleDirs.find((c) => c.includes('agent_connection'))!;
    const initPy = tree
      .read(`packages/common/agent_connection/${moduleName}/__init__.py`)!
      .toString();
    expect(initPy).toContain('MyGatewayClient');
    expect(initPy).toContain('my_gateway_client');
  });

  it('patches agent.py to enter the gateway client in a `with` block', async () => {
    setupProjects();
    await pyAgentGatewayConnectionGenerator(tree, fullOptions());

    const agent = tree
      .read('packages/my-agent/my_scope_my_agent/agent/agent.py')!
      .toString();

    expect(agent).toContain('MyGatewayClient');
    expect(agent).toContain('my_gateway = MyGatewayClient.create()');
    // The gateway client is an MCPClient context manager — entered directly.
    expect(agent).toMatch(/with \([\s\S]*?my_gateway[\s\S]*?\):/);
    // Tools array spreads list_tools_sync() — the same shape mcp-connection uses.
    expect(agent).toContain('*my_gateway.list_tools_sync()');
  });

  it('chains agent serve-local onto gateway serve-local', async () => {
    setupProjects();
    await pyAgentGatewayConnectionGenerator(tree, fullOptions());

    const cfg = JSON.parse(
      tree.read('packages/my-agent/project.json')!.toString(),
    );
    const deps = cfg.targets['my-agent-serve-local'].dependsOn;
    expect(deps).toContainEqual(
      expect.objectContaining({
        projects: ['@test/my-gateway'],
        target: 'my-gateway-serve-local',
      }),
    );
  });

  it('is idempotent: re-running does not duplicate the create() call', async () => {
    setupProjects();
    await pyAgentGatewayConnectionGenerator(tree, fullOptions());
    await pyAgentGatewayConnectionGenerator(tree, fullOptions());

    const agent = tree
      .read('packages/my-agent/my_scope_my_agent/agent/agent.py')!
      .toString();
    const createCount = (agent.match(/MyGatewayClient\.create/g) ?? []).length;
    expect(createCount).toBe(1);
  });

  it('rejects a missing source component ref', async () => {
    setupProjects();
    await expect(
      pyAgentGatewayConnectionGenerator(tree, {
        sourceProject: 'my_scope.my_agent',
        targetProject: '@test/my-gateway',
      }),
    ).rejects.toThrow(/sourceComponent must be provided/);
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
      pyAgentGatewayConnectionGenerator(tree, fullOptions()),
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
      pyAgentGatewayConnectionGenerator(tree, fullOptions()),
    ).rejects.toThrow(/Only IAM-authenticated gateways/);
  });

  it('rejects non-IAM agent', async () => {
    setupProjects();
    await expect(
      pyAgentGatewayConnectionGenerator(tree, {
        ...fullOptions(),
        sourceComponent: {
          ...fullOptions().sourceComponent,
          auth: 'Cognito',
        } as any,
      }),
    ).rejects.toThrow(/Only IAM-authenticated agents/);
  });

  it('exposes stable generator info id', () => {
    expect(PY_AGENT_GATEWAY_CONNECTION_GENERATOR_INFO.id).toBe(
      'py#agent#gateway-connection',
    );
  });
});
