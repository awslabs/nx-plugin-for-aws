/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  readProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../utils/test.js';
import { agentcoreGatewayReactConnectionGenerator } from './generator.js';

describe('agentcore-gateway#react-connection generator', () => {
  let tree: Tree;

  const addWebsite = () => {
    addProjectConfiguration(tree, 'frontend', {
      name: 'frontend',
      root: 'apps/frontend',
      sourceRoot: 'apps/frontend/src',
      targets: { dev: {} },
      metadata: {} as any,
    });
    tree.write(
      'apps/frontend/package.json',
      JSON.stringify({ name: '@proj/frontend', type: 'module' }),
    );
    tree.write(
      'apps/frontend/src/main.tsx',
      `
const App = () => <div />;

export function Main() {
  return <App />;
}
`,
    );
  };

  const addGateway = ({
    protocol = 'http',
    auth = 'iam',
    components = [] as unknown[],
  } = {}) => {
    addProjectConfiguration(tree, '@proj/my-gateway', {
      name: '@proj/my-gateway',
      root: 'packages/my-gateway',
      projectType: 'library',
      sourceRoot: 'packages/my-gateway',
      targets: {
        dev: {
          executor: 'nx:run-commands',
          continuous: true,
          options: { commands: ['tsx local-dev.ts'] },
          dependsOn: [],
        },
      },
      metadata: {
        generator: 'agentcore-gateway',
        name: 'my-gateway',
        rc: 'MyGateway',
        protocol,
        auth,
        port: 8100,
        components,
      } as any,
    });
  };

  const addAguiAgent = () => {
    addProjectConfiguration(tree, 'ts-project', {
      name: 'ts-project',
      root: 'packages/ts-project',
      sourceRoot: 'packages/ts-project/src',
      targets: { 'my-agent-dev': { continuous: true } },
      metadata: {
        components: [
          {
            generator: 'ts#agent',
            name: 'my-agent',
            rc: 'MyAgent',
            path: 'src/my-agent',
            protocol: 'ag-ui',
            auth: 'iam',
            port: 8081,
          },
        ],
      } as any,
    });
  };

  const agentConnectionComponent = {
    generator: 'agentcore-gateway#agent-connection',
    path: 'packages/ts-project',
    name: 'my-agent',
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('generates a gateway-routed AG-UI hook for each fronted agent', async () => {
    addWebsite();
    addAguiAgent();
    addGateway({ components: [agentConnectionComponent] });

    await agentcoreGatewayReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: '@proj/my-gateway',
    });

    const hook = tree.read(
      'apps/frontend/src/hooks/useAguiMyAgent.tsx',
      'utf-8',
    );
    expect(hook).toContain('runtimeConfig.gateways.MyGateway');
    expect(hook).toContain('/my-agent/invocations');
    expect(hook).not.toContain('runtimeConfig.agentRuntimes');
    expect(hook).toMatchSnapshot('useAguiMyAgent.tsx');
  });

  it('wires the website dev target to the local gateway', async () => {
    addWebsite();
    addAguiAgent();
    addGateway({ components: [agentConnectionComponent] });

    await agentcoreGatewayReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: '@proj/my-gateway',
    });

    const config = readProjectConfiguration(tree, 'frontend');
    expect(config.targets?.['dev'].dependsOn).toContainEqual(
      expect.objectContaining({
        projects: ['@proj/my-gateway'],
        target: 'dev',
      }),
    );

    // The local-dev override points the gateway's runtime config entry at the
    // local gateway
    const runtimeConfig = tree.read(
      'apps/frontend/src/components/RuntimeConfig/index.tsx',
      'utf-8',
    );
    // Spread rather than member assignment, so the fetch-failure fallback
    // config (which has no gateways key) doesn't throw. Matched with
    // flexible whitespace since the formatter may wrap the object literal.
    expect(runtimeConfig.replace(/\s+/g, ' ')).toContain(
      `runtimeConfig.gateways = { ...runtimeConfig.gateways, MyGateway: 'http://localhost:8100', }`,
    );
  });

  it('adds a local-dev override per gateway when connected to several', async () => {
    addWebsite();
    addAguiAgent();
    addGateway({ components: [agentConnectionComponent] });

    // A second gateway on its own port, fronting a second agent.
    addProjectConfiguration(tree, 'ts-project-2', {
      name: 'ts-project-2',
      root: 'packages/ts-project-2',
      sourceRoot: 'packages/ts-project-2/src',
      targets: { 'other-agent-dev': { continuous: true } },
      metadata: {
        components: [
          {
            generator: 'ts#agent',
            name: 'other-agent',
            rc: 'OtherAgent',
            path: 'src/other-agent',
            protocol: 'ag-ui',
            auth: 'iam',
            port: 8082,
          },
        ],
      } as any,
    });
    addProjectConfiguration(tree, '@proj/other-gateway', {
      name: '@proj/other-gateway',
      root: 'packages/other-gateway',
      projectType: 'library',
      sourceRoot: 'packages/other-gateway',
      targets: {
        dev: {
          executor: 'nx:run-commands',
          continuous: true,
          options: { commands: ['tsx local-dev.ts'] },
          dependsOn: [],
        },
      },
      metadata: {
        generator: 'agentcore-gateway',
        name: 'other-gateway',
        rc: 'OtherGateway',
        protocol: 'http',
        auth: 'iam',
        port: 8101,
        components: [
          {
            generator: 'agentcore-gateway#agent-connection',
            path: 'packages/ts-project-2',
            name: 'other-agent',
          },
        ],
      } as any,
    });

    await agentcoreGatewayReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: '@proj/my-gateway',
    });
    await agentcoreGatewayReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: '@proj/other-gateway',
    });

    // Both gateways get their own override — the second connection must not be
    // skipped by an idempotency guard keyed on the shared `gateways` object.
    const runtimeConfig = tree
      .read('apps/frontend/src/components/RuntimeConfig/index.tsx', 'utf-8')!
      .replace(/\s+/g, ' ');
    expect(runtimeConfig).toContain(
      `runtimeConfig.gateways = { ...runtimeConfig.gateways, MyGateway: 'http://localhost:8100', }`,
    );
    expect(runtimeConfig).toContain(
      `runtimeConfig.gateways = { ...runtimeConfig.gateways, OtherGateway: 'http://localhost:8101', }`,
    );
  });

  it('records connection metadata on the website project', async () => {
    addWebsite();
    addAguiAgent();
    addGateway({ components: [agentConnectionComponent] });

    await agentcoreGatewayReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: '@proj/my-gateway',
    });

    const config = readProjectConfiguration(tree, 'frontend');
    expect((config.metadata as any).components).toContainEqual(
      expect.objectContaining({
        generator: 'agentcore-gateway#react-connection',
        name: 'MyGateway',
      }),
    );
  });

  it('is idempotent when re-run with the same inputs', async () => {
    addWebsite();
    addAguiAgent();
    addGateway({ components: [agentConnectionComponent] });

    const run = () =>
      agentcoreGatewayReactConnectionGenerator(tree, {
        sourceProject: 'frontend',
        targetProject: '@proj/my-gateway',
      });
    await run();
    const hookAfterFirst = tree.read(
      'apps/frontend/src/hooks/useAguiMyAgent.tsx',
      'utf-8',
    );
    const mainAfterFirst = tree.read('apps/frontend/src/main.tsx', 'utf-8');
    const configAfterFirst = readProjectConfiguration(tree, 'frontend');

    await run();

    expect(
      tree.read('apps/frontend/src/hooks/useAguiMyAgent.tsx', 'utf-8'),
    ).toEqual(hookAfterFirst);
    expect(tree.read('apps/frontend/src/main.tsx', 'utf-8')).toEqual(
      mainAfterFirst,
    );
    expect(readProjectConfiguration(tree, 'frontend')).toEqual(
      configAfterFirst,
    );
  });

  it('throws for an mcp-protocol gateway', async () => {
    addWebsite();
    addGateway({ protocol: 'mcp' });

    await expect(
      agentcoreGatewayReactConnectionGenerator(tree, {
        sourceProject: 'frontend',
        targetProject: '@proj/my-gateway',
      }),
    ).rejects.toThrow(/http-protocol gateways/);
  });

  it('connects a gateway with no agents attached, warning instead of failing', async () => {
    addWebsite();
    addGateway();

    // No agent clients yet, but the gateway URL is still published and the
    // dev target wired — re-running after attaching agents adds their clients.
    await agentcoreGatewayReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: '@proj/my-gateway',
    });

    const config = readProjectConfiguration(tree, 'frontend');
    expect(config.targets?.['dev'].dependsOn).toContainEqual(
      expect.objectContaining({
        projects: ['@proj/my-gateway'],
        target: 'dev',
      }),
    );
    expect(tree.exists('apps/frontend/src/hooks/useAguiMyAgent.tsx')).toBe(
      false,
    );
  });
});
