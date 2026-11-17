/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { tsRdbAgentConnectionGenerator } from '../../../ts/rdb/agent-connection/generator.js';
import { tsRdbMcpServerConnectionGenerator } from '../../../ts/rdb/mcp-server-connection/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const ENV_LINE =
  'ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/rds-bundle.crt';

// The RDS CA step ts#rdb's agent and MCP server connections wrote before they
// set NODE_EXTRA_CA_CERTS.
const OLD_RDS_CA_RUN = [
  'RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \\',
  '    rm -rf /var/lib/apt/lists/* && \\',
  '    curl -fsSL "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem" \\',
  '    -o /usr/local/share/ca-certificates/rds-bundle.crt && \\',
  '    update-ca-certificates',
].join('\n');

/** A ts#agent / ts#mcp-server Dockerfile before any rdb connection. */
const vendedDockerfile = (
  port: number,
) => `FROM public.ecr.aws/docker/library/node:lts-slim

RUN apt-get update && \\
    apt-get upgrade -y --no-install-recommends && \\
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY index.js /app

EXPOSE ${port}

CMD [ "node", "--require", "@aws/aws-distro-opentelemetry-node-autoinstrumentation/register", "index.js" ]
`;

/** The same Dockerfile after a connection from an older plugin version. */
const oldConnectedDockerfile = (port: number) =>
  vendedDockerfile(port).replace(
    `EXPOSE ${port}`,
    `${OLD_RDS_CA_RUN}\n\nEXPOSE ${port}`,
  );

type Component = { generator: string; name: string; path: string };

const seedProject = (tree: Tree, name: string, components: Component[]) => {
  addProjectConfiguration(tree, name, {
    name,
    root: `packages/${name}`,
    sourceRoot: `packages/${name}/src`,
    projectType: 'application',
    targets: {},
    metadata: { components } as any,
  });
};

const seedRdbProject = (tree: Tree) =>
  addProjectConfiguration(tree, 'db', {
    name: 'db',
    root: 'packages/db',
    targets: {},
  });

const agent = (name: string): Component => ({
  generator: 'ts#agent',
  name,
  path: `src/${name}`,
});
const mcpServer = (name: string): Component => ({
  generator: 'ts#mcp-server',
  name,
  path: `src/${name}`,
});

const count = (content: string, text: string) => content.split(text).length - 1;

describe('ts-rdb-node-extra-ca-certs migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('converges on the generator (agent)', async () => {
    const dockerfile = 'packages/svc/src/my-agent/Dockerfile';
    seedProject(tree, 'svc', [agent('my-agent')]);
    tree.write(dockerfile, oldConnectedDockerfile(8080));

    await migration(tree);

    const fresh = createTreeUsingTsSolutionSetup();
    seedProject(fresh, 'svc', [agent('my-agent')]);
    seedRdbProject(fresh);
    fresh.write(dockerfile, vendedDockerfile(8080));
    await tsRdbAgentConnectionGenerator(fresh, {
      sourceProject: 'svc',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#agent', name: 'my-agent' },
    });

    expect(tree.read(dockerfile, 'utf-8')).toBe(
      fresh.read(dockerfile, 'utf-8'),
    );
  });

  it('converges on the generator (mcp-server)', async () => {
    const dockerfile = 'packages/svc/src/my-mcp/Dockerfile';
    seedProject(tree, 'svc', [mcpServer('my-mcp')]);
    tree.write(dockerfile, oldConnectedDockerfile(8000));

    await migration(tree);

    const fresh = createTreeUsingTsSolutionSetup();
    seedProject(fresh, 'svc', [mcpServer('my-mcp')]);
    seedRdbProject(fresh);
    fresh.write(dockerfile, vendedDockerfile(8000));
    await tsRdbMcpServerConnectionGenerator(fresh, {
      sourceProject: 'svc',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#mcp-server', name: 'my-mcp' },
    });

    expect(tree.read(dockerfile, 'utf-8')).toBe(
      fresh.read(dockerfile, 'utf-8'),
    );
  });

  it('is a no-op on a freshly fixed Dockerfile', async () => {
    const dockerfile = 'packages/svc/src/my-agent/Dockerfile';
    seedProject(tree, 'svc', [agent('my-agent')]);
    seedRdbProject(tree);
    tree.write(dockerfile, vendedDockerfile(8080));
    await tsRdbAgentConnectionGenerator(tree, {
      sourceProject: 'svc',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#agent', name: 'my-agent' },
    });
    const before = tree.read(dockerfile, 'utf-8');

    const result = await migration(tree);

    expect(tree.read(dockerfile, 'utf-8')).toBe(before);
    expect(result.nextSteps).toEqual([]);
  });

  it('is idempotent', async () => {
    const dockerfile = 'packages/svc/src/my-agent/Dockerfile';
    seedProject(tree, 'svc', [agent('my-agent')]);
    tree.write(dockerfile, oldConnectedDockerfile(8080));

    await migration(tree);
    const first = tree.read(dockerfile, 'utf-8')!;
    const result = await migration(tree);

    expect(tree.read(dockerfile, 'utf-8')).toBe(first);
    expect(count(first, ENV_LINE)).toBe(1);
    expect(result.nextSteps).toEqual([]);
  });

  it('migrates multiple components across projects', async () => {
    seedProject(tree, 'svc-a', [agent('agent-one'), agent('agent-two')]);
    seedProject(tree, 'svc-b', [mcpServer('my-mcp')]);
    const dockerfiles = [
      'packages/svc-a/src/agent-one/Dockerfile',
      'packages/svc-a/src/agent-two/Dockerfile',
      'packages/svc-b/src/my-mcp/Dockerfile',
    ];
    tree.write(dockerfiles[0], oldConnectedDockerfile(8080));
    tree.write(dockerfiles[1], oldConnectedDockerfile(9000));
    tree.write(dockerfiles[2], oldConnectedDockerfile(8000));

    await migration(tree);

    for (const dockerfile of dockerfiles) {
      expect(count(tree.read(dockerfile, 'utf-8')!, ENV_LINE)).toBe(1);
    }
  });

  it('ignores a Dockerfile without the RDS CA step', async () => {
    const dockerfile = 'packages/svc/src/my-agent/Dockerfile';
    seedProject(tree, 'svc', [agent('my-agent')]);
    tree.write(dockerfile, vendedDockerfile(8080));

    const result = await migration(tree);

    expect(tree.read(dockerfile, 'utf-8')).toBe(vendedDockerfile(8080));
    expect(result.nextSteps).toEqual([]);
  });

  it('ignores py#agent components', async () => {
    const dockerfile = 'packages/py/my_agent/Dockerfile';
    const pyDockerfile = `FROM public.ecr.aws/docker/library/python:3.14-slim

ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /usr/local/share/ca-certificates/rds-global-bundle.crt
RUN update-ca-certificates

EXPOSE 8080
`;
    seedProject(tree, 'py', [
      { generator: 'py#agent', name: 'my-agent', path: 'my_agent' },
    ]);
    tree.write(dockerfile, pyDockerfile);

    const result = await migration(tree);

    expect(tree.read(dockerfile, 'utf-8')).toBe(pyDockerfile);
    expect(result.nextSteps).toEqual([]);
  });

  it('reports a diverged CA step and leaves it unchanged', async () => {
    const dockerfile = 'packages/svc/src/my-agent/Dockerfile';
    const customised = vendedDockerfile(8080).replace(
      'EXPOSE 8080',
      'COPY rds-bundle.crt /usr/local/share/ca-certificates/rds-bundle.crt\nRUN update-ca-certificates\n\nEXPOSE 8080',
    );
    seedProject(tree, 'svc', [agent('my-agent')]);
    tree.write(dockerfile, customised);

    const result = await migration(tree);

    expect(tree.read(dockerfile, 'utf-8')).toBe(customised);
    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps![0]).toContain(dockerfile);
    expect(result.nextSteps![0]).toContain(ENV_LINE);
  });

  it('is a no-op in a workspace without components', async () => {
    const result = await migration(tree);

    expect(result).toEqual({ nextSteps: [] });
  });
});
