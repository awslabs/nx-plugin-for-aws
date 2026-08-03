/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  readProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { agentcoreGatewayReactConnectionGenerator } from './generator';

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
    expect(runtimeConfig).toContain(
      `runtimeConfig.gateways.MyGateway = 'http://localhost:8100'`,
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

  it('throws when the gateway has no agents attached', async () => {
    addWebsite();
    addGateway();

    await expect(
      agentcoreGatewayReactConnectionGenerator(tree, {
        sourceProject: 'frontend',
        targetProject: '@proj/my-gateway',
      }),
    ).rejects.toThrow(/no AG-UI or HTTP agents attached/);
  });
});
