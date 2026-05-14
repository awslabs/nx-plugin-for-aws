/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree, readProjectConfiguration } from '@nx/devkit';
import { describe, it, expect, beforeEach } from 'vitest';
import { tsRdbMcpServerConnectionGenerator } from './generator';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';

describe('ts#rdb mcp-server-connection generator', () => {
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
          [`${mcpServerName}-serve-local`]: {
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
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should add rdb serve-local dependency to the mcp-server prefixed serve-local', async () => {
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

  it('should fall back to mcp-server-serve-local when no component name', async () => {
    setupMcpServerProject('my-service', 'mcp-server');
    setupRdbProject();

    await tsRdbMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-service',
      targetProject: 'db',
      sourceComponent: { generator: 'ts#mcp-server' },
    });

    expect(readProjectConfiguration(tree, 'my-service')).toMatchSnapshot();
  });

  it('should not add dependency when mcp-server serve-local target does not exist', async () => {
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
    expect(config.targets?.['my-mcp-serve-local']).toBeUndefined();
  });

  it('should be idempotent for serve-local wiring', async () => {
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
    const deps = (
      config.targets?.['my-mcp-serve-local']?.dependsOn ?? []
    ).filter(
      (d: any) =>
        typeof d === 'object' &&
        d.projects?.includes('db') &&
        d.target === 'serve-local',
    );
    expect(deps).toHaveLength(1);
  });
});
