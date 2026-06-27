/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import {
  AGENTCORE_GATEWAY_MCP_CONNECTION_GENERATOR_INFO,
  agentcoreGatewayMcpConnectionGenerator,
} from './generator';

describe('agentcore-gateway#mcp-connection generator', () => {
  let tree: Tree;

  const addGateway = (name = 'my-gateway', rc = 'MyGateway') => {
    addProjectConfiguration(tree, `@proj/${name}`, {
      name: `@proj/${name}`,
      root: `packages/${name}`,
      projectType: 'library',
      sourceRoot: `packages/${name}`,
      targets: {
        [`${name}-dev`]: {
          executor: 'nx:run-commands',
          continuous: true,
          options: { commands: ['node -e "setInterval(()=>{}, 1000)"'] },
          dependsOn: [],
        },
      },
      metadata: {
        generator: 'agentcore-gateway',
        name,
        rc,
        protocol: 'mcp',
        auth: 'iam',
        port: 8100,
      } as any,
    });
    return { name, rc };
  };

  const addMcp = (name = 'my-mcp', rc = 'MyMcp', port = 8000) => {
    addProjectConfiguration(tree, `@proj/${name}`, {
      name: `@proj/${name}`,
      root: `packages/${name}`,
      projectType: 'library',
      sourceRoot: `packages/${name}`,
      targets: { [`${name}-dev`]: {} },
      metadata: {} as any,
    });
    return { name, rc, port };
  };

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

  it('wires dev dependency from gateway to MCP server', async () => {
    const gw = addGateway();
    const mcp = addMcp();

    await agentcoreGatewayMcpConnectionGenerator(tree, {
      sourceProject: `@proj/${gw.name}`,
      targetProject: `@proj/${mcp.name}`,
      targetComponent: mcpComponent(mcp) as any,
    });

    const { readProjectConfiguration } = await import('@nx/devkit');
    const config = readProjectConfiguration(tree, `@proj/${gw.name}`);
    const deps = config.targets?.[`${gw.name}-dev`].dependsOn as any[];
    expect(deps).toContainEqual(
      expect.objectContaining({
        projects: [`@proj/${mcp.name}`],
        target: `${mcp.name}-dev`,
      }),
    );
  });

  it('registers the MCP server in the gateway local-dev.ts', async () => {
    const gw = addGateway();
    const mcp = addMcp('other-mcp', 'OtherMcp', 8001);

    tree.write(
      'packages/my-gateway/local-dev.ts',
      `const ATTACHED_MCP_SERVERS: AttachedMcpServer[] = [
  { name: 'already-there', url: 'http://localhost:8000/mcp' },
];
`,
    );

    await agentcoreGatewayMcpConnectionGenerator(tree, {
      sourceProject: `@proj/${gw.name}`,
      targetProject: `@proj/${mcp.name}`,
      targetComponent: mcpComponent(mcp) as any,
    });

    const serveTs = tree.read('packages/my-gateway/local-dev.ts')!.toString();
    expect(serveTs).toContain("name: 'other-mcp'");
    expect(serveTs).toContain("url: 'http://localhost:8001/mcp'");
    // The existing entry is preserved, with no dangling separators from the
    // trailing comma in the formatted array
    expect(serveTs).toContain('already-there');
    expect(serveTs).not.toMatch(/,\s*,/);
  });

  it('registers two MCP servers that share a default component name without clashing', async () => {
    // Both ts#mcp-server and py#mcp-server vend the component as
    // `name: 'mcp-server'` by default — the registration must use the
    // project's `rc` to keep them distinct.
    const gw = addGateway();
    const tsMcp = { name: 'mcp-server', rc: 'TsMcp', port: 8000 };
    addProjectConfiguration(tree, '@proj/ts-app', {
      name: '@proj/ts-app',
      root: 'packages/ts-app',
      projectType: 'library',
      sourceRoot: 'packages/ts-app',
      targets: { 'mcp-server-dev': {} },
      metadata: {} as any,
    });
    const pyMcp = { name: 'mcp-server', rc: 'PyMcp', port: 8001 };
    addProjectConfiguration(tree, '@proj/py-app', {
      name: '@proj/py-app',
      root: 'packages/py-app',
      projectType: 'library',
      sourceRoot: 'packages/py-app',
      targets: { 'mcp-server-dev': {} },
      metadata: {} as any,
    });
    tree.write(
      'packages/my-gateway/local-dev.ts',
      `const ATTACHED_MCP_SERVERS: AttachedMcpServer[] = [];\n`,
    );

    await agentcoreGatewayMcpConnectionGenerator(tree, {
      sourceProject: `@proj/${gw.name}`,
      targetProject: '@proj/ts-app',
      targetComponent: mcpComponent(tsMcp) as any,
    });
    await agentcoreGatewayMcpConnectionGenerator(tree, {
      sourceProject: `@proj/${gw.name}`,
      targetProject: '@proj/py-app',
      targetComponent: mcpComponent(pyMcp) as any,
    });

    const serveTs = tree.read('packages/my-gateway/local-dev.ts')!.toString();
    expect(serveTs).toContain("name: 'ts-mcp'");
    expect(serveTs).toContain("name: 'py-mcp'");
    expect(serveTs).toContain("url: 'http://localhost:8000/mcp'");
    expect(serveTs).toContain("url: 'http://localhost:8001/mcp'");
  });

  it('local-dev.ts registration is idempotent for the same MCP server', async () => {
    const gw = addGateway();
    const mcp = addMcp('other-mcp', 'OtherMcp', 8001);

    tree.write(
      'packages/my-gateway/local-dev.ts',
      `const ATTACHED_MCP_SERVERS: AttachedMcpServer[] = [
];
`,
    );

    await agentcoreGatewayMcpConnectionGenerator(tree, {
      sourceProject: `@proj/${gw.name}`,
      targetProject: `@proj/${mcp.name}`,
      targetComponent: mcpComponent(mcp) as any,
    });
    await agentcoreGatewayMcpConnectionGenerator(tree, {
      sourceProject: `@proj/${gw.name}`,
      targetProject: `@proj/${mcp.name}`,
      targetComponent: mcpComponent(mcp) as any,
    });

    const serveTs = tree.read('packages/my-gateway/local-dev.ts')!.toString();
    const occurrences = (serveTs.match(/'other-mcp'/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('fails when the source project was not generated by agentcore-gateway', async () => {
    const gw = addGateway();
    const mcp = addMcp();
    const { readProjectConfiguration, updateProjectConfiguration } =
      await import('@nx/devkit');
    const config = readProjectConfiguration(tree, `@proj/${gw.name}`);
    (config.metadata as any).generator = 'ts#project';
    updateProjectConfiguration(tree, `@proj/${gw.name}`, config);
    await expect(
      agentcoreGatewayMcpConnectionGenerator(tree, {
        sourceProject: `@proj/${gw.name}`,
        targetProject: `@proj/${mcp.name}`,
        targetComponent: mcpComponent(mcp) as any,
      }),
    ).rejects.toThrow(/was not generated by/);
  });

  it('fails when target is missing metadata', async () => {
    const gw = addGateway();
    const mcp = addMcp();
    await expect(
      agentcoreGatewayMcpConnectionGenerator(tree, {
        sourceProject: `@proj/${gw.name}`,
        targetProject: `@proj/${mcp.name}`,
      }),
    ).rejects.toThrow(/no MCP server component metadata/);
  });

  it('fails when gateway is non-MCP protocol', async () => {
    const gw = addGateway();
    const mcp = addMcp();
    const { readProjectConfiguration, updateProjectConfiguration } =
      await import('@nx/devkit');
    const config = readProjectConfiguration(tree, `@proj/${gw.name}`);
    (config.metadata as any).protocol = 'Runtime';
    updateProjectConfiguration(tree, `@proj/${gw.name}`, config);
    await expect(
      agentcoreGatewayMcpConnectionGenerator(tree, {
        sourceProject: `@proj/${gw.name}`,
        targetProject: `@proj/${mcp.name}`,
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
      '../../utils/shared-constructs'
    );
    await sharedConstructsGenerator(tree, { iac: 'cdk' });

    await agentcoreGatewayMcpConnectionGenerator(tree, {
      sourceProject: `@proj/${gw.name}`,
      targetProject: `@proj/${mcp.name}`,
      targetComponent: mcpComponent(mcp) as any,
    });

    expectHasMetricTags(
      tree,
      AGENTCORE_GATEWAY_MCP_CONNECTION_GENERATOR_INFO.metric,
    );
  });

  it('exposes stable generator info id', () => {
    expect(AGENTCORE_GATEWAY_MCP_CONNECTION_GENERATOR_INFO.id).toBe(
      'agentcore-gateway#mcp-connection',
    );
  });
});
