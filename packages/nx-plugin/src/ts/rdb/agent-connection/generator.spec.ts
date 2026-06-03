/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readProjectConfiguration, type Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import { tsRdbAgentConnectionGenerator } from './generator';

describe('ts#rdb agent-connection generator', () => {
  let tree: Tree;

  const setupRdbProject = (name = 'db') => {
    tree.write(
      `packages/${name}/project.json`,
      JSON.stringify({
        name,
        root: `packages/${name}`,
        targets: {
          'serve-local': { executor: 'nx:run-commands', continuous: true },
        },
      }),
    );
  };

  const setupAgentProject = (
    name = 'my-service',
    agentName = 'my-agent',
    protocol = 'HTTP',
  ) => {
    tree.write(
      `packages/${name}/project.json`,
      JSON.stringify({
        name,
        root: `packages/${name}`,
        targets: {
          [`${agentName}-serve-local`]: {
            executor: 'nx:run-commands',
            continuous: true,
          },
        },
        metadata: {
          components: [
            {
              generator: 'ts#agent',
              name: agentName,
              path: `src/${agentName}`,
              protocol,
            },
          ],
        },
      }),
    );

    const exposePort = protocol === 'A2A' ? 9000 : 8080;
    tree.write(
      `packages/${name}/src/${agentName}/Dockerfile`,
      `FROM public.ecr.aws/docker/library/node:lts-jod

WORKDIR /app

RUN npm install @aws/aws-distro-opentelemetry-node-autoinstrumentation@0.7.0

COPY index.js /app

EXPOSE ${exposePort}

CMD [ "node", "--require", "@aws/aws-distro-opentelemetry-node-autoinstrumentation/register", "index.js" ]
`,
    );
    tree.write(
      `packages/${name}/src/${agentName}/agent.ts`,
      `import { Agent, tool } from '@strands-agents/sdk';
import { z } from 'zod';

const multiply = tool({
  name: 'Multiply',
  description: 'Multiply two numbers',
  inputSchema: z.object({ a: z.number(), b: z.number() }),
  callback: ({ a, b }) => a * b,
});

export const getAgent = async () => {
  return new Agent({
    systemPrompt: 'You are a helpful assistant.',
    tools: [multiply],
  });
};
`,
    );
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should add rdb serve-local dependency to the agent prefixed serve-local', async () => {
    setupAgentProject('my-service', 'my-agent');
    setupRdbProject();

    await tsRdbAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#agent', name: 'my-agent' },
    });

    expect(readProjectConfiguration(tree, 'my-service')).toMatchSnapshot();
  });

  it('should inject db into agent.ts', async () => {
    setupAgentProject('my-service', 'my-agent');
    setupRdbProject();

    await tsRdbAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#agent', name: 'my-agent' },
    });

    expect(
      tree.read('packages/my-service/src/my-agent/agent.ts', 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should be idempotent for agent.ts injection', async () => {
    setupAgentProject('my-service', 'my-agent');
    setupRdbProject();

    await tsRdbAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#agent', name: 'my-agent' },
    });
    await tsRdbAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#agent', name: 'my-agent' },
    });

    expect(
      tree.read('packages/my-service/src/my-agent/agent.ts', 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should support multiple rdb connections in agent.ts', async () => {
    setupAgentProject('my-service', 'my-agent');
    setupRdbProject('postgres-db');
    setupRdbProject('mysql-db');

    await tsRdbAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'postgres-db',
      sourceComponent: { generator: 'ts#agent', name: 'my-agent' },
    });
    await tsRdbAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'mysql-db',
      sourceComponent: { generator: 'ts#agent', name: 'my-agent' },
    });

    expect(
      tree.read('packages/my-service/src/my-agent/agent.ts', 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should fall back to agent-serve-local when no component name', async () => {
    setupAgentProject('my-service', 'agent');
    setupRdbProject();

    await tsRdbAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#agent' },
    });

    expect(readProjectConfiguration(tree, 'my-service')).toMatchSnapshot();
  });

  it('should inject db into agent.ts for A2A', async () => {
    setupAgentProject('my-service', 'my-agent', 'A2A');
    setupRdbProject();

    await tsRdbAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#agent', name: 'my-agent' },
    });

    expect(
      tree.read('packages/my-service/src/my-agent/agent.ts', 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should be idempotent for A2A agent.ts injection', async () => {
    setupAgentProject('my-service', 'my-agent', 'A2A');
    setupRdbProject();

    await tsRdbAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#agent', name: 'my-agent' },
    });
    await tsRdbAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#agent', name: 'my-agent' },
    });

    expect(
      tree.read('packages/my-service/src/my-agent/agent.ts', 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should add RDS CA bundle to Dockerfile (HTTP)', async () => {
    setupAgentProject('my-service', 'my-agent', 'HTTP');
    setupRdbProject();

    await tsRdbAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#agent', name: 'my-agent' },
    });

    expect(
      tree.read('packages/my-service/src/my-agent/Dockerfile', 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should add RDS CA bundle to Dockerfile (A2A)', async () => {
    setupAgentProject('my-service', 'my-agent', 'A2A');
    setupRdbProject();

    await tsRdbAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#agent', name: 'my-agent' },
    });

    expect(
      tree.read('packages/my-service/src/my-agent/Dockerfile', 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should be idempotent for Dockerfile', async () => {
    setupAgentProject('my-service', 'my-agent', 'HTTP');
    setupRdbProject();

    await tsRdbAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#agent', name: 'my-agent' },
    });
    await tsRdbAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#agent', name: 'my-agent' },
    });

    expect(
      tree.read('packages/my-service/src/my-agent/Dockerfile', 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should not add dependency when agent serve-local target does not exist', async () => {
    tree.write(
      `packages/my-service/project.json`,
      JSON.stringify({
        name: 'my-service',
        root: 'packages/my-service',
        targets: {},
      }),
    );
    setupRdbProject();

    await tsRdbAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#agent', name: 'my-agent' },
    });

    const config = readProjectConfiguration(tree, 'my-service');
    expect(config.targets?.['my-agent-serve-local']).toBeUndefined();
  });

  it('should be idempotent for serve-local wiring', async () => {
    setupAgentProject('my-service', 'my-agent');
    setupRdbProject();

    await tsRdbAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#agent', name: 'my-agent' },
    });
    await tsRdbAgentConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#agent', name: 'my-agent' },
    });

    const config = readProjectConfiguration(tree, 'my-service');
    const deps = (
      config.targets?.['my-agent-serve-local']?.dependsOn ?? []
    ).filter(
      (d: any) =>
        typeof d === 'object' &&
        d.projects?.includes('db') &&
        d.target === 'serve-local',
    );
    expect(deps).toHaveLength(1);
  });
});
