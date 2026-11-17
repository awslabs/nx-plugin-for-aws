/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readProjectConfiguration, type Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import { tsRdbAgentConnectionGenerator } from './generator.js';

describe('ts#rdb agent-connection generator', () => {
  let tree: Tree;

  const setupRdbProject = (name = 'db') => {
    tree.write(
      `packages/${name}/project.json`,
      JSON.stringify({
        name,
        root: `packages/${name}`,
        targets: {
          dev: { executor: 'nx:run-commands', continuous: true },
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
          [`${agentName}-dev`]: {
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

  it('should add rdb dev dependency to the agent prefixed dev', async () => {
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

  it('should fall back to agent-dev when no component name', async () => {
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

  describe('NODE_EXTRA_CA_CERTS in the Dockerfile', () => {
    // The CA step as the connection generator wrote it before it set
    // NODE_EXTRA_CA_CERTS. Node ignores the OS trust store it fills.
    const OLD_VENDED_STEP = [
      'RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \\',
      '    rm -rf /var/lib/apt/lists/* && \\',
      '    curl -fsSL "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem" \\',
      '    -o /usr/local/share/ca-certificates/rds-bundle.crt && \\',
      '    update-ca-certificates',
    ].join('\n');
    const COMMENT_LINE =
      '# Node trusts only its bundled CA store unless it is given extra certificates.';
    const ENV_LINE =
      'ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/rds-bundle.crt';
    const DOCKERFILE = 'packages/my-service/src/my-agent/Dockerfile';

    const connect = () =>
      tsRdbAgentConnectionGenerator(tree, {
        sourceProject: 'my-service',
        targetProject: 'db',
        sourceComponent: { generator: 'ts#agent', name: 'my-agent' },
      });
    const readDockerfile = () => tree.read(DOCKERFILE, 'utf-8')!;
    const count = (content: string, text: string) =>
      content.split(text).length - 1;

    /** The Dockerfile a fresh agent gets from the connection generator today. */
    const freshlyConnectedDockerfile = async () => {
      const original = tree;
      tree = createTreeUsingTsSolutionSetup();
      setupAgentProject('my-service', 'my-agent');
      setupRdbProject();
      await connect();
      const content = readDockerfile();
      tree = original;
      return content;
    };

    beforeEach(() => {
      setupAgentProject('my-service', 'my-agent');
      setupRdbProject();
    });

    it('fresh Dockerfile sets NODE_EXTRA_CA_CERTS after the CA step', async () => {
      await connect();

      const content = readDockerfile();
      expect(count(content, ENV_LINE)).toBe(1);
      expect(content.indexOf(ENV_LINE)).toBeGreaterThan(
        content.indexOf('update-ca-certificates\n'),
      );
      expect(content.indexOf(ENV_LINE)).toBeLessThan(
        content.indexOf('EXPOSE 8080'),
      );
      expect(content).toContain(`${COMMENT_LINE}\n${ENV_LINE}\n`);
    });

    it('old Dockerfile with the CA step and no ENV gets the ENV once', async () => {
      tree.write(
        DOCKERFILE,
        readDockerfile().replace(
          'EXPOSE 8080',
          `${OLD_VENDED_STEP}\n\nEXPOSE 8080`,
        ),
      );

      await connect();

      const content = readDockerfile();
      expect(count(content, ENV_LINE)).toBe(1);
      expect(content).toBe(await freshlyConnectedDockerfile());
    });

    it('Dockerfile that already sets both is unchanged', async () => {
      const fixed = await freshlyConnectedDockerfile();
      tree.write(DOCKERFILE, fixed);

      await connect();

      expect(readDockerfile()).toBe(fixed);
    });

    it('running twice changes nothing', async () => {
      await connect();
      const first = readDockerfile();
      await connect();

      const second = readDockerfile();
      expect(count(second, 'rds-bundle.crt && \\')).toBe(1);
      expect(count(second, ENV_LINE)).toBe(1);
      expect(second).toBe(first);
    });

    it('Dockerfile without an EXPOSE line is left unchanged', async () => {
      // The CA step is inserted before the first EXPOSE; without one, nothing
      // is inserted.
      const noExpose = readDockerfile().replace('EXPOSE 8080\n\n', '');
      tree.write(DOCKERFILE, noExpose);

      await connect();

      expect(readDockerfile()).toBe(noExpose);
      expect(readDockerfile()).not.toContain(ENV_LINE);
    });

    it('user-set NODE_EXTRA_CA_CERTS is kept', async () => {
      tree.write(
        DOCKERFILE,
        readDockerfile().replace(
          'EXPOSE 8080',
          'ENV NODE_EXTRA_CA_CERTS=/custom.pem\n\nEXPOSE 8080',
        ),
      );

      await connect();

      const content = readDockerfile();
      expect(content).toContain('rds-bundle.crt && \\');
      expect(count(content, 'NODE_EXTRA_CA_CERTS')).toBe(1);
      expect(content).toContain('ENV NODE_EXTRA_CA_CERTS=/custom.pem');
    });

    it('customised CA step is left unchanged', async () => {
      const customised = readDockerfile().replace(
        'EXPOSE 8080',
        'COPY rds-bundle.crt /usr/local/share/ca-certificates/rds-bundle.crt\nRUN update-ca-certificates\n\nEXPOSE 8080',
      );
      tree.write(DOCKERFILE, customised);

      await connect();

      expect(readDockerfile()).toBe(customised);
    });
  });

  it('should not add dependency when agent dev target does not exist', async () => {
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
    expect(config.targets?.['my-agent-dev']).toBeUndefined();
  });

  it('should be idempotent for dev wiring', async () => {
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
    const deps = (config.targets?.['my-agent-dev']?.dependsOn ?? []).filter(
      (d: any) =>
        typeof d === 'object' &&
        d.projects?.includes('db') &&
        d.target === 'dev',
    );
    expect(deps).toHaveLength(1);
  });
});
