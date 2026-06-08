/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { expectHasMetricTags } from '../../../utils/metrics.spec';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import {
  AGENTCORE_GATEWAY_MCP_CONNECTION_GENERATOR_INFO,
  agentcoreGatewayMcpConnectionGenerator,
} from './generator';

describe('cedar#agentcore-gateway#mcp-connection generator', () => {
  let tree: Tree;

  const addGateway = (name = 'my-gateway', rc = 'MyGateway') => {
    addProjectConfiguration(tree, `@proj/${name}`, {
      name: `@proj/${name}`,
      root: `packages/${name}`,
      projectType: 'library',
      sourceRoot: `packages/${name}`,
      targets: {
        [`${name}-serve-local`]: {
          executor: 'nx:run-commands',
          continuous: true,
          options: { commands: ['node -e "setInterval(()=>{}, 1000)"'] },
          dependsOn: [],
        },
      },
      metadata: {} as any,
    });
    return { name, rc };
  };

  const addMcp = (name = 'my-mcp', rc = 'MyMcp', port = 8000) => {
    addProjectConfiguration(tree, `@proj/${name}`, {
      name: `@proj/${name}`,
      root: `packages/${name}`,
      projectType: 'library',
      sourceRoot: `packages/${name}`,
      targets: { [`${name}-serve-local`]: {} },
      metadata: {} as any,
    });
    return { name, rc, port };
  };

  const gwComponent = (gw: { name: string; rc: string }) => ({
    generator: 'cedar#agentcore-gateway',
    name: gw.name,
    rc: gw.rc,
    protocol: 'mcp',
    auth: 'iam',
  });

  const mcpComponent = (mcp: { name: string; rc: string; port: number }) => ({
    generator: 'ts#mcp-server',
    name: mcp.name,
    rc: mcp.rc,
    port: mcp.port,
    auth: 'iam',
  });

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('wires serve-local dependency from gateway to MCP server', async () => {
    const gw = addGateway();
    const mcp = addMcp();

    await agentcoreGatewayMcpConnectionGenerator(tree, {
      sourceProject: `@proj/${gw.name}`,
      targetProject: `@proj/${mcp.name}`,
      sourceComponent: gwComponent(gw) as any,
      targetComponent: mcpComponent(mcp) as any,
    });

    const { readProjectConfiguration } = await import('@nx/devkit');
    const config = readProjectConfiguration(tree, `@proj/${gw.name}`);
    const deps = config.targets?.[`${gw.name}-serve-local`].dependsOn as any[];
    expect(deps).toContainEqual(
      expect.objectContaining({
        projects: [`@proj/${mcp.name}`],
        target: `${mcp.name}-serve-local`,
      }),
    );
  });

  it('back-propagates MCP server into an existing TS gateway client', async () => {
    const gw = addGateway();
    const mcp = addMcp('other-mcp', 'OtherMcp', 8001);

    // Simulate a TS gateway client generated earlier by the
    // `ts#strands-agent#gateway-connection` generator.
    tree.write(
      'packages/common/agent-connection/src/app/my-gateway-client.ts',
      `import { McpClient } from '@strands-agents/sdk';
import { LocalMcpServerBinding } from '../core/agentcore-gateway-mcp-local-client.js';

const ATTACHED_MCP_SERVERS: LocalMcpServerBinding[] = [
  { name: 'already-there', localUrl: 'http://localhost:8000/mcp' },
];

export class MyGatewayClient {
  static async create(sessionId: string): Promise<McpClient | McpClient[]> {
    return null as any;
  }
}
`,
    );

    await agentcoreGatewayMcpConnectionGenerator(tree, {
      sourceProject: `@proj/${gw.name}`,
      targetProject: `@proj/${mcp.name}`,
      sourceComponent: gwComponent(gw) as any,
      targetComponent: mcpComponent(mcp) as any,
    });

    const client = tree
      .read('packages/common/agent-connection/src/app/my-gateway-client.ts')!
      .toString();
    expect(client).toContain("name: 'other-mcp'");
    expect(client).toContain("localUrl: 'http://localhost:8001/mcp'");
    // The existing entry is preserved
    expect(client).toContain('already-there');
  });

  it('back-propagation is idempotent for the same MCP server', async () => {
    const gw = addGateway();
    const mcp = addMcp('other-mcp', 'OtherMcp', 8001);

    tree.write(
      'packages/common/agent-connection/src/app/my-gateway-client.ts',
      `import { LocalMcpServerBinding } from '../core/agentcore-gateway-mcp-local-client.js';

const ATTACHED_MCP_SERVERS: LocalMcpServerBinding[] = [
];
`,
    );

    await agentcoreGatewayMcpConnectionGenerator(tree, {
      sourceProject: `@proj/${gw.name}`,
      targetProject: `@proj/${mcp.name}`,
      sourceComponent: gwComponent(gw) as any,
      targetComponent: mcpComponent(mcp) as any,
    });
    await agentcoreGatewayMcpConnectionGenerator(tree, {
      sourceProject: `@proj/${gw.name}`,
      targetProject: `@proj/${mcp.name}`,
      sourceComponent: gwComponent(gw) as any,
      targetComponent: mcpComponent(mcp) as any,
    });

    const client = tree
      .read('packages/common/agent-connection/src/app/my-gateway-client.ts')!
      .toString();
    const occurrences = (client.match(/'other-mcp'/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('back-propagates MCP server into an existing Python gateway client', async () => {
    const gw = addGateway();
    const mcp = addMcp('py-mcp-x', 'PyMcpX', 8001);

    tree.write(
      'packages/common/agent_connection/my_mod/app/my_gateway_client.py',
      `from .core.agentcore_gateway_mcp_local_client import LocalMcpServerBinding

ATTACHED_MCP_SERVERS: list[LocalMcpServerBinding] = [
]


class MyGatewayClient:
    @staticmethod
    def create(session_id: str):
        return None
`,
    );

    await agentcoreGatewayMcpConnectionGenerator(tree, {
      sourceProject: `@proj/${gw.name}`,
      targetProject: `@proj/${mcp.name}`,
      sourceComponent: gwComponent(gw) as any,
      targetComponent: mcpComponent(mcp) as any,
    });

    const client = tree
      .read('packages/common/agent_connection/my_mod/app/my_gateway_client.py')!
      .toString();
    expect(client).toContain('LocalMcpServerBinding(');
    expect(client).toContain('name="py-mcp-x"');
    expect(client).toContain('local_url="http://localhost:8001/mcp"');
  });

  it('fails when source is missing metadata', async () => {
    const gw = addGateway();
    const mcp = addMcp();
    await expect(
      agentcoreGatewayMcpConnectionGenerator(tree, {
        sourceProject: `@proj/${gw.name}`,
        targetProject: `@proj/${mcp.name}`,
        targetComponent: mcpComponent(mcp) as any,
      }),
    ).rejects.toThrow(/no AgentCore Gateway component metadata/);
  });

  it('fails when target is missing metadata', async () => {
    const gw = addGateway();
    const mcp = addMcp();
    await expect(
      agentcoreGatewayMcpConnectionGenerator(tree, {
        sourceProject: `@proj/${gw.name}`,
        targetProject: `@proj/${mcp.name}`,
        sourceComponent: gwComponent(gw) as any,
      }),
    ).rejects.toThrow(/no MCP server component metadata/);
  });

  it('fails when gateway is non-MCP protocol', async () => {
    const gw = addGateway();
    const mcp = addMcp();
    await expect(
      agentcoreGatewayMcpConnectionGenerator(tree, {
        sourceProject: `@proj/${gw.name}`,
        targetProject: `@proj/${mcp.name}`,
        sourceComponent: {
          ...gwComponent(gw),
          protocol: 'Runtime',
        } as any,
        targetComponent: mcpComponent(mcp) as any,
      }),
    ).rejects.toThrow(/MCP-protocol gateways/);
  });

  it('fails when MCP server is not IAM auth', async () => {
    const gw = addGateway();
    const mcp = addMcp();
    await expect(
      agentcoreGatewayMcpConnectionGenerator(tree, {
        sourceProject: `@proj/${gw.name}`,
        targetProject: `@proj/${mcp.name}`,
        sourceComponent: gwComponent(gw) as any,
        targetComponent: {
          ...mcpComponent(mcp),
          auth: 'Cognito',
        } as any,
      }),
    ).rejects.toThrow(/IAM authentication/);
  });

  it('adds generator metric tags', async () => {
    const gw = addGateway();
    const mcp = addMcp();
    const { sharedConstructsGenerator } = await import(
      '../../../utils/shared-constructs'
    );
    await sharedConstructsGenerator(tree, { iac: 'cdk' });

    await agentcoreGatewayMcpConnectionGenerator(tree, {
      sourceProject: `@proj/${gw.name}`,
      targetProject: `@proj/${mcp.name}`,
      sourceComponent: gwComponent(gw) as any,
      targetComponent: mcpComponent(mcp) as any,
    });

    expectHasMetricTags(
      tree,
      AGENTCORE_GATEWAY_MCP_CONNECTION_GENERATOR_INFO.metric,
    );
  });

  it('exposes stable generator info id', () => {
    expect(AGENTCORE_GATEWAY_MCP_CONNECTION_GENERATOR_INFO.id).toBe(
      'cedar#agentcore-gateway#mcp-connection',
    );
  });
});
