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
import { agentcoreGatewayAgentConnectionGenerator } from './generator.js';

describe('agentcore-gateway#agent-connection generator', () => {
  let tree: Tree;

  const addGateway = (
    name = 'my-gateway',
    rc = 'MyGateway',
    protocol = 'http',
  ) => {
    addProjectConfiguration(tree, `@proj/${name}`, {
      name: `@proj/${name}`,
      root: `packages/${name}`,
      projectType: 'library',
      sourceRoot: `packages/${name}`,
      targets: {
        dev: {
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
        protocol,
        auth: 'iam',
        port: 8100,
      } as any,
    });
    return { name, rc };
  };

  const addAgentProject = (name = 'ts-project') => {
    addProjectConfiguration(tree, name, {
      name,
      root: `packages/${name}`,
      projectType: 'library',
      sourceRoot: `packages/${name}/src`,
      targets: { 'my-agent-dev': { continuous: true } },
      metadata: {} as any,
    });
    return name;
  };

  const agentComponent = ({
    generator = 'ts#agent',
    protocol = 'ag-ui',
    auth = 'iam',
    port = 8081,
  } = {}) => ({
    generator,
    name: 'my-agent',
    rc: 'MyAgent',
    path: 'src/my-agent',
    protocol,
    auth,
    port,
  });

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('wires dev dependency from gateway to agent', async () => {
    const gw = addGateway();
    const project = addAgentProject();

    await agentcoreGatewayAgentConnectionGenerator(tree, {
      sourceProject: `@proj/${gw.name}`,
      targetProject: project,
      targetComponent: agentComponent() as any,
    });

    const config = readProjectConfiguration(tree, `@proj/${gw.name}`);
    expect(config.targets?.['dev'].dependsOn).toContainEqual(
      expect.objectContaining({
        projects: [project],
        target: 'my-agent-dev',
      }),
    );
  });

  it('registers the agent in the gateway local-dev.ts', async () => {
    const gw = addGateway();
    const project = addAgentProject();

    tree.write(
      'packages/my-gateway/local-dev.ts',
      `const ATTACHED_AGENTS: AttachedAgent[] = [];
`,
    );

    await agentcoreGatewayAgentConnectionGenerator(tree, {
      sourceProject: `@proj/${gw.name}`,
      targetProject: project,
      targetComponent: agentComponent() as any,
    });

    const localDev = tree.read('packages/my-gateway/local-dev.ts', 'utf-8');
    expect(localDev).toContain(`name: 'my-agent'`);
    expect(localDev).toContain(`url: 'http://localhost:8081'`);
    expect(localDev).toContain('stripInvocations: false');
  });

  it('strips the invocations prefix for a2a agents', async () => {
    const gw = addGateway();
    const project = addAgentProject();

    tree.write(
      'packages/my-gateway/local-dev.ts',
      `const ATTACHED_AGENTS: AttachedAgent[] = [];
`,
    );

    await agentcoreGatewayAgentConnectionGenerator(tree, {
      sourceProject: `@proj/${gw.name}`,
      targetProject: project,
      targetComponent: agentComponent({ protocol: 'a2a', port: 9000 }) as any,
    });

    const localDev = tree.read('packages/my-gateway/local-dev.ts', 'utf-8');
    expect(localDev).toContain('stripInvocations: true');
  });

  it('records connection metadata on the gateway project', async () => {
    const gw = addGateway();
    const project = addAgentProject();

    await agentcoreGatewayAgentConnectionGenerator(tree, {
      sourceProject: `@proj/${gw.name}`,
      targetProject: project,
      targetComponent: agentComponent() as any,
    });

    const config = readProjectConfiguration(tree, `@proj/${gw.name}`);
    expect((config.metadata as any).components).toContainEqual(
      expect.objectContaining({
        generator: 'agentcore-gateway#agent-connection',
        name: 'my-agent',
        path: `packages/${project}`,
      }),
    );
  });

  it('is idempotent when re-run with the same inputs', async () => {
    const gw = addGateway();
    const project = addAgentProject();
    tree.write(
      'packages/my-gateway/local-dev.ts',
      `const ATTACHED_AGENTS: AttachedAgent[] = [];
`,
    );

    const run = () =>
      agentcoreGatewayAgentConnectionGenerator(tree, {
        sourceProject: `@proj/${gw.name}`,
        targetProject: project,
        targetComponent: agentComponent() as any,
      });
    await run();
    const localDevAfterFirst = tree.read(
      'packages/my-gateway/local-dev.ts',
      'utf-8',
    );
    const configAfterFirst = readProjectConfiguration(tree, `@proj/${gw.name}`);

    await run();

    expect(tree.read('packages/my-gateway/local-dev.ts', 'utf-8')).toEqual(
      localDevAfterFirst,
    );
    expect(readProjectConfiguration(tree, `@proj/${gw.name}`)).toEqual(
      configAfterFirst,
    );
  });

  it('throws for an mcp-protocol gateway', async () => {
    const gw = addGateway('mcp-gateway', 'McpGateway', 'mcp');
    const project = addAgentProject();

    await expect(
      agentcoreGatewayAgentConnectionGenerator(tree, {
        sourceProject: `@proj/${gw.name}`,
        targetProject: project,
        targetComponent: agentComponent() as any,
      }),
    ).rejects.toThrow(/http-protocol gateways/);
  });

  it('throws for a ts http (tRPC over WebSocket) agent', async () => {
    const gw = addGateway();
    const project = addAgentProject();

    await expect(
      agentcoreGatewayAgentConnectionGenerator(tree, {
        sourceProject: `@proj/${gw.name}`,
        targetProject: project,
        targetComponent: agentComponent({ protocol: 'http' }) as any,
      }),
    ).rejects.toThrow(/WebSocket/);
  });

  it('allows a py http agent', async () => {
    const gw = addGateway();
    const project = addAgentProject();

    await expect(
      agentcoreGatewayAgentConnectionGenerator(tree, {
        sourceProject: `@proj/${gw.name}`,
        targetProject: project,
        targetComponent: agentComponent({
          generator: 'py#agent',
          protocol: 'http',
        }) as any,
      }),
    ).resolves.toBeDefined();
  });

  it('connects a cognito agent (fronted via JWT passthrough)', async () => {
    const gw = addGateway();
    const project = addAgentProject();

    await expect(
      agentcoreGatewayAgentConnectionGenerator(tree, {
        sourceProject: `@proj/${gw.name}`,
        targetProject: project,
        targetComponent: agentComponent({ auth: 'cognito' }) as any,
      }),
    ).resolves.toBeDefined();
  });

  it('throws for an agent whose auth a gateway cannot front', async () => {
    const gw = addGateway();
    const project = addAgentProject();

    await expect(
      agentcoreGatewayAgentConnectionGenerator(tree, {
        sourceProject: `@proj/${gw.name}`,
        targetProject: project,
        targetComponent: agentComponent({ auth: 'apikey' }) as any,
      }),
    ).rejects.toThrow(/gateway cannot front/);
  });

  it('throws when the target has no agent component metadata', async () => {
    const gw = addGateway();
    const project = addAgentProject();

    await expect(
      agentcoreGatewayAgentConnectionGenerator(tree, {
        sourceProject: `@proj/${gw.name}`,
        targetProject: project,
      }),
    ).rejects.toThrow(/no agent component metadata/);
  });
});
