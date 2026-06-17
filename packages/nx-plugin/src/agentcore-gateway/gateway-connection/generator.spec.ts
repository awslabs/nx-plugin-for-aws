/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  readProjectConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import {
  AGENTCORE_GATEWAY_GATEWAY_CONNECTION_GENERATOR_INFO,
  agentcoreGatewayGatewayConnectionGenerator,
} from './generator';

describe('agentcore-gateway#gateway-connection generator', () => {
  let tree: Tree;

  const addGateway = (name: string, rc: string, port: number) => {
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
      metadata: {
        generator: 'agentcore-gateway',
        name,
        rc,
        protocol: 'mcp',
        auth: 'iam',
        port,
      } as any,
    });
    return { name, rc, port };
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('wires serve-local dependency from source gateway to target gateway', async () => {
    const outer = addGateway('outer-gateway', 'OuterGateway', 8100);
    const inner = addGateway('inner-gateway', 'InnerGateway', 8101);

    await agentcoreGatewayGatewayConnectionGenerator(tree, {
      sourceProject: `@proj/${outer.name}`,
      targetProject: `@proj/${inner.name}`,
    });

    const config = readProjectConfiguration(tree, `@proj/${outer.name}`);
    const deps = config.targets?.[`${outer.name}-serve-local`]
      .dependsOn as any[];
    expect(deps).toContainEqual(
      expect.objectContaining({
        projects: [`@proj/${inner.name}`],
        target: `${inner.name}-serve-local`,
      }),
    );
  });

  it('registers the target gateway in the source gateway serve-local.ts', async () => {
    const outer = addGateway('outer-gateway', 'OuterGateway', 8100);
    const inner = addGateway('inner-gateway', 'InnerGateway', 8101);

    tree.write(
      'packages/outer-gateway/serve-local.ts',
      `const ATTACHED_MCP_SERVERS: AttachedMcpServer[] = [
  { name: 'already-there', url: 'http://localhost:8000/mcp' },
];
`,
    );

    await agentcoreGatewayGatewayConnectionGenerator(tree, {
      sourceProject: `@proj/${outer.name}`,
      targetProject: `@proj/${inner.name}`,
    });

    const serveTs = tree
      .read('packages/outer-gateway/serve-local.ts')!
      .toString();
    // Registered under the target gateway's local port, prefixing its
    // (already-prefixed) tools as <gateway>___<target>___<tool>
    expect(serveTs).toContain("name: 'inner-gateway'");
    expect(serveTs).toContain("url: 'http://localhost:8101/mcp'");
    expect(serveTs).toContain('already-there');
    expect(serveTs).not.toMatch(/,\s*,/);
  });

  it('serve-local.ts registration is idempotent for the same gateway', async () => {
    const outer = addGateway('outer-gateway', 'OuterGateway', 8100);
    const inner = addGateway('inner-gateway', 'InnerGateway', 8101);

    tree.write(
      'packages/outer-gateway/serve-local.ts',
      `const ATTACHED_MCP_SERVERS: AttachedMcpServer[] = [];\n`,
    );

    await agentcoreGatewayGatewayConnectionGenerator(tree, {
      sourceProject: `@proj/${outer.name}`,
      targetProject: `@proj/${inner.name}`,
    });
    await agentcoreGatewayGatewayConnectionGenerator(tree, {
      sourceProject: `@proj/${outer.name}`,
      targetProject: `@proj/${inner.name}`,
    });

    const serveTs = tree
      .read('packages/outer-gateway/serve-local.ts')!
      .toString();
    expect((serveTs.match(/'inner-gateway'/g) ?? []).length).toBe(1);

    const config = readProjectConfiguration(tree, `@proj/${outer.name}`);
    const deps = config.targets?.[`${outer.name}-serve-local`]
      .dependsOn as any[];
    expect(
      deps.filter((d) => d.target === `${inner.name}-serve-local`).length,
    ).toBe(1);
  });

  it('supports chains of three gateways', async () => {
    const outer = addGateway('outer-gateway', 'OuterGateway', 8100);
    const middle = addGateway('middle-gateway', 'MiddleGateway', 8101);
    const inner = addGateway('inner-gateway', 'InnerGateway', 8102);
    tree.write(
      'packages/outer-gateway/serve-local.ts',
      `const ATTACHED_MCP_SERVERS: AttachedMcpServer[] = [];\n`,
    );
    tree.write(
      'packages/middle-gateway/serve-local.ts',
      `const ATTACHED_MCP_SERVERS: AttachedMcpServer[] = [];\n`,
    );

    await agentcoreGatewayGatewayConnectionGenerator(tree, {
      sourceProject: `@proj/${outer.name}`,
      targetProject: `@proj/${middle.name}`,
    });
    await agentcoreGatewayGatewayConnectionGenerator(tree, {
      sourceProject: `@proj/${middle.name}`,
      targetProject: `@proj/${inner.name}`,
    });

    expect(
      tree.read('packages/outer-gateway/serve-local.ts')!.toString(),
    ).toContain("name: 'middle-gateway'");
    expect(
      tree.read('packages/middle-gateway/serve-local.ts')!.toString(),
    ).toContain("name: 'inner-gateway'");
  });

  it('fails when connecting a gateway to itself', async () => {
    const gw = addGateway('my-gateway', 'MyGateway', 8100);
    await expect(
      agentcoreGatewayGatewayConnectionGenerator(tree, {
        sourceProject: `@proj/${gw.name}`,
        targetProject: `@proj/${gw.name}`,
      }),
    ).rejects.toThrow(/itself/);
  });

  it('fails when the connection would create a cycle', async () => {
    const a = addGateway('gateway-a', 'GatewayA', 8100);
    const b = addGateway('gateway-b', 'GatewayB', 8101);

    await agentcoreGatewayGatewayConnectionGenerator(tree, {
      sourceProject: `@proj/${a.name}`,
      targetProject: `@proj/${b.name}`,
    });

    await expect(
      agentcoreGatewayGatewayConnectionGenerator(tree, {
        sourceProject: `@proj/${b.name}`,
        targetProject: `@proj/${a.name}`,
      }),
    ).rejects.toThrow(/cycle/);
  });

  it('fails when the connection would create a transitive cycle', async () => {
    const a = addGateway('gateway-a', 'GatewayA', 8100);
    const b = addGateway('gateway-b', 'GatewayB', 8101);
    const c = addGateway('gateway-c', 'GatewayC', 8102);

    await agentcoreGatewayGatewayConnectionGenerator(tree, {
      sourceProject: `@proj/${a.name}`,
      targetProject: `@proj/${b.name}`,
    });
    await agentcoreGatewayGatewayConnectionGenerator(tree, {
      sourceProject: `@proj/${b.name}`,
      targetProject: `@proj/${c.name}`,
    });

    await expect(
      agentcoreGatewayGatewayConnectionGenerator(tree, {
        sourceProject: `@proj/${c.name}`,
        targetProject: `@proj/${a.name}`,
      }),
    ).rejects.toThrow(/cycle/);
  });

  it('cycle detection ignores non-gateway serve-local dependencies', async () => {
    const outer = addGateway('outer-gateway', 'OuterGateway', 8100);
    const inner = addGateway('inner-gateway', 'InnerGateway', 8101);
    // The inner gateway already fronts an MCP server
    addProjectConfiguration(tree, '@proj/some-mcp', {
      name: '@proj/some-mcp',
      root: 'packages/some-mcp',
      projectType: 'library',
      sourceRoot: 'packages/some-mcp',
      targets: { 'some-mcp-serve-local': {} },
      metadata: {} as any,
    });
    const innerConfig = readProjectConfiguration(tree, `@proj/${inner.name}`);
    innerConfig.targets![`${inner.name}-serve-local`].dependsOn = [
      { projects: ['@proj/some-mcp'], target: 'some-mcp-serve-local' },
    ];
    updateProjectConfiguration(tree, `@proj/${inner.name}`, innerConfig);

    await expect(
      agentcoreGatewayGatewayConnectionGenerator(tree, {
        sourceProject: `@proj/${outer.name}`,
        targetProject: `@proj/${inner.name}`,
      }),
    ).resolves.toBeDefined();
  });

  it('fails when the source project was not generated by agentcore-gateway', async () => {
    const outer = addGateway('outer-gateway', 'OuterGateway', 8100);
    const inner = addGateway('inner-gateway', 'InnerGateway', 8101);
    const config = readProjectConfiguration(tree, `@proj/${outer.name}`);
    (config.metadata as any).generator = 'ts#project';
    updateProjectConfiguration(tree, `@proj/${outer.name}`, config);
    await expect(
      agentcoreGatewayGatewayConnectionGenerator(tree, {
        sourceProject: `@proj/${outer.name}`,
        targetProject: `@proj/${inner.name}`,
      }),
    ).rejects.toThrow(/was not generated by/);
  });

  it('fails when the target project was not generated by agentcore-gateway', async () => {
    const outer = addGateway('outer-gateway', 'OuterGateway', 8100);
    const inner = addGateway('inner-gateway', 'InnerGateway', 8101);
    const config = readProjectConfiguration(tree, `@proj/${inner.name}`);
    (config.metadata as any).generator = 'ts#project';
    updateProjectConfiguration(tree, `@proj/${inner.name}`, config);
    await expect(
      agentcoreGatewayGatewayConnectionGenerator(tree, {
        sourceProject: `@proj/${outer.name}`,
        targetProject: `@proj/${inner.name}`,
      }),
    ).rejects.toThrow(/was not generated by/);
  });

  it('fails when either gateway is non-MCP protocol', async () => {
    const outer = addGateway('outer-gateway', 'OuterGateway', 8100);
    const inner = addGateway('inner-gateway', 'InnerGateway', 8101);
    const config = readProjectConfiguration(tree, `@proj/${inner.name}`);
    (config.metadata as any).protocol = 'a2a';
    updateProjectConfiguration(tree, `@proj/${inner.name}`, config);
    await expect(
      agentcoreGatewayGatewayConnectionGenerator(tree, {
        sourceProject: `@proj/${outer.name}`,
        targetProject: `@proj/${inner.name}`,
      }),
    ).rejects.toThrow(/MCP-protocol gateways/);
  });

  it('fails when the target gateway is not IAM auth', async () => {
    const outer = addGateway('outer-gateway', 'OuterGateway', 8100);
    const inner = addGateway('inner-gateway', 'InnerGateway', 8101);
    const config = readProjectConfiguration(tree, `@proj/${inner.name}`);
    (config.metadata as any).auth = 'cognito';
    updateProjectConfiguration(tree, `@proj/${inner.name}`, config);
    await expect(
      agentcoreGatewayGatewayConnectionGenerator(tree, {
        sourceProject: `@proj/${outer.name}`,
        targetProject: `@proj/${inner.name}`,
      }),
    ).rejects.toThrow(/IAM authentication/);
  });

  it('allows a non-IAM source gateway since it signs the hop with its own role', async () => {
    const outer = addGateway('outer-gateway', 'OuterGateway', 8100);
    const inner = addGateway('inner-gateway', 'InnerGateway', 8101);
    const config = readProjectConfiguration(tree, `@proj/${outer.name}`);
    (config.metadata as any).auth = 'cognito';
    updateProjectConfiguration(tree, `@proj/${outer.name}`, config);
    await expect(
      agentcoreGatewayGatewayConnectionGenerator(tree, {
        sourceProject: `@proj/${outer.name}`,
        targetProject: `@proj/${inner.name}`,
      }),
    ).resolves.toBeDefined();
  });

  it('adds generator metric tags', async () => {
    const outer = addGateway('outer-gateway', 'OuterGateway', 8100);
    const inner = addGateway('inner-gateway', 'InnerGateway', 8101);
    const { sharedConstructsGenerator } = await import(
      '../../utils/shared-constructs'
    );
    await sharedConstructsGenerator(tree, { iac: 'cdk' });

    await agentcoreGatewayGatewayConnectionGenerator(tree, {
      sourceProject: `@proj/${outer.name}`,
      targetProject: `@proj/${inner.name}`,
    });

    expectHasMetricTags(
      tree,
      AGENTCORE_GATEWAY_GATEWAY_CONNECTION_GENERATOR_INFO.metric,
    );
  });

  it('exposes stable generator info id', () => {
    expect(AGENTCORE_GATEWAY_GATEWAY_CONNECTION_GENERATOR_INFO.id).toBe(
      'agentcore-gateway#gateway-connection',
    );
  });
});
