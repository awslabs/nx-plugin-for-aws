/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readProjectConfiguration, type Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import { tsRdbMcpServerConnectionGenerator } from './generator.js';

describe('ts#rdb mcp-server-connection generator', () => {
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

  const setupMcpServerProject = (
    name = 'my-service',
    mcpServerName = 'mcp-server',
  ) => {
    tree.write(
      `packages/${name}/project.json`,
      JSON.stringify({
        name,
        root: `packages/${name}`,
        targets: {
          [`${mcpServerName}-dev`]: {
            executor: 'nx:run-commands',
            continuous: true,
          },
        },
        metadata: {
          components: [
            {
              generator: 'ts#mcp-server',
              name: mcpServerName,
              path: `src/${mcpServerName}`,
            },
          ],
        },
      }),
    );
    tree.write(
      `packages/${name}/src/${mcpServerName}/server.ts`,
      `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const createServer = async () => {
  const server = new McpServer({
    name: "my-service",
    version: "1.0.0"
  });

  return server;
};
`,
    );
    tree.write(
      `packages/${name}/src/${mcpServerName}/Dockerfile`,
      `FROM public.ecr.aws/docker/library/node:lts-jod

WORKDIR /app

RUN npm install @aws/aws-distro-opentelemetry-node-autoinstrumentation@0.7.0

COPY index.js /app

EXPOSE 8000

CMD [ "node", "--require", "@aws/aws-distro-opentelemetry-node-autoinstrumentation/register", "index.js" ]
`,
    );
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should add rdb dev dependency to the mcp-server prefixed dev', async () => {
    setupMcpServerProject('my-service', 'my-mcp');
    setupRdbProject();

    await tsRdbMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#mcp-server', name: 'my-mcp' },
    });

    expect(readProjectConfiguration(tree, 'my-service')).toMatchSnapshot();
  });

  it('should inject db into server.ts', async () => {
    setupMcpServerProject('my-service', 'my-mcp');
    setupRdbProject();

    await tsRdbMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#mcp-server', name: 'my-mcp' },
    });

    expect(
      tree.read('packages/my-service/src/my-mcp/server.ts', 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should be idempotent for server.ts', async () => {
    setupMcpServerProject('my-service', 'my-mcp');
    setupRdbProject();

    await tsRdbMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#mcp-server', name: 'my-mcp' },
    });
    await tsRdbMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#mcp-server', name: 'my-mcp' },
    });

    expect(
      tree.read('packages/my-service/src/my-mcp/server.ts', 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should support multiple rdb connections', async () => {
    setupMcpServerProject('my-service', 'my-mcp');
    setupRdbProject('postgres-db');
    setupRdbProject('mysql-db');

    await tsRdbMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'postgres-db',
      sourceComponent: { generator: 'ts#mcp-server', name: 'my-mcp' },
    });
    await tsRdbMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'mysql-db',
      sourceComponent: { generator: 'ts#mcp-server', name: 'my-mcp' },
    });

    expect(
      tree.read('packages/my-service/src/my-mcp/server.ts', 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should fall back to mcp-server-dev when no component name', async () => {
    setupMcpServerProject('my-service', 'mcp-server');
    setupRdbProject();

    await tsRdbMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#mcp-server' },
    });

    expect(readProjectConfiguration(tree, 'my-service')).toMatchSnapshot();
  });

  it('should add RDS CA bundle to Dockerfile', async () => {
    setupMcpServerProject('my-service', 'my-mcp');
    setupRdbProject();

    await tsRdbMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#mcp-server', name: 'my-mcp' },
    });

    expect(
      tree.read('packages/my-service/src/my-mcp/Dockerfile', 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should be idempotent for Dockerfile', async () => {
    setupMcpServerProject('my-service', 'my-mcp');
    setupRdbProject();

    await tsRdbMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#mcp-server', name: 'my-mcp' },
    });
    await tsRdbMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#mcp-server', name: 'my-mcp' },
    });

    expect(
      tree.read('packages/my-service/src/my-mcp/Dockerfile', 'utf-8'),
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
    const DOCKERFILE = 'packages/my-service/src/my-mcp/Dockerfile';

    const connect = () =>
      tsRdbMcpServerConnectionGenerator(tree, {
        sourceProject: 'my-service',
        targetProject: 'db',
        sourceComponent: { generator: 'ts#mcp-server', name: 'my-mcp' },
      });
    const readDockerfile = () => tree.read(DOCKERFILE, 'utf-8')!;
    const count = (content: string, text: string) =>
      content.split(text).length - 1;

    beforeEach(() => {
      setupMcpServerProject('my-service', 'my-mcp');
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
        content.indexOf('EXPOSE 8000'),
      );
      expect(content).toContain(`${COMMENT_LINE}\n${ENV_LINE}\n`);
    });

    it('old Dockerfile with the CA step and no ENV gets the ENV once', async () => {
      const original = readDockerfile();
      await connect();
      const fresh = readDockerfile();

      tree.write(
        DOCKERFILE,
        original.replace('EXPOSE 8000', `${OLD_VENDED_STEP}\n\nEXPOSE 8000`),
      );
      await connect();

      const content = readDockerfile();
      expect(count(content, ENV_LINE)).toBe(1);
      expect(content).toBe(fresh);
    });
  });

  it('should not add dependency when mcp-server dev target does not exist', async () => {
    tree.write(
      `packages/my-service/project.json`,
      JSON.stringify({
        name: 'my-service',
        root: 'packages/my-service',
        targets: {},
      }),
    );
    setupRdbProject();

    await tsRdbMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#mcp-server', name: 'my-mcp' },
    });

    const config = readProjectConfiguration(tree, 'my-service');
    expect(config.targets?.['my-mcp-dev']).toBeUndefined();
  });

  it('should be idempotent for dev wiring', async () => {
    setupMcpServerProject('my-service', 'my-mcp');
    setupRdbProject();

    await tsRdbMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#mcp-server', name: 'my-mcp' },
    });
    await tsRdbMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#mcp-server', name: 'my-mcp' },
    });

    const config = readProjectConfiguration(tree, 'my-service');
    const deps = (config.targets?.['my-mcp-dev']?.dependsOn ?? []).filter(
      (d: any) =>
        typeof d === 'object' &&
        d.projects?.includes('db') &&
        d.target === 'dev',
    );
    expect(deps).toHaveLength(1);
  });
});
