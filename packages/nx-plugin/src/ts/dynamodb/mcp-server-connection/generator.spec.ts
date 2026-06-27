/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readProjectConfiguration, type Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import { tsDynamoDBMcpServerConnectionGenerator } from './generator';

describe('ts#dynamodb mcp-server-connection generator', () => {
  let tree: Tree;

  const setupDynamoDBProject = (name = 'db') => {
    tree.write(
      `packages/${name}/project.json`,
      JSON.stringify({
        name,
        root: `packages/${name}`,
        targets: {
          'dev': { executor: 'nx:run-commands', continuous: true },
        },
      }),
    );
  };

  const setupMcpProject = (name = 'my-mcp', serverName = 'mcp-server') => {
    tree.write(
      `packages/${name}/project.json`,
      JSON.stringify({
        name,
        root: `packages/${name}`,
        targets: {
          [`${serverName}-dev`]: {
            executor: 'nx:run-commands',
            continuous: true,
          },
        },
      }),
    );
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should add dynamodb dev dependency to mcp-server dev', async () => {
    setupMcpProject();
    setupDynamoDBProject();

    await tsDynamoDBMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-mcp',
      targetProject: 'db',
    });

    expect(readProjectConfiguration(tree, 'my-mcp')).toMatchSnapshot();
  });

  it('should use sourceComponent name when provided', async () => {
    setupMcpProject('my-mcp', 'custom-server');
    setupDynamoDBProject();

    await tsDynamoDBMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-mcp',
      targetProject: 'db',
      sourceComponent: { name: 'custom-server' },
    });

    expect(readProjectConfiguration(tree, 'my-mcp')).toMatchSnapshot();
  });

  it('should not add dependency when source has no matching dev', async () => {
    tree.write(
      `packages/my-mcp/project.json`,
      JSON.stringify({
        name: 'my-mcp',
        root: 'packages/my-mcp',
        targets: { build: {} },
      }),
    );
    setupDynamoDBProject();

    await tsDynamoDBMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-mcp',
      targetProject: 'db',
    });

    const config = readProjectConfiguration(tree, 'my-mcp');
    expect(config.targets?.['mcp-server-dev']).toBeUndefined();
  });

  it('should be idempotent', async () => {
    setupMcpProject();
    setupDynamoDBProject();

    await tsDynamoDBMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-mcp',
      targetProject: 'db',
    });
    await tsDynamoDBMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-mcp',
      targetProject: 'db',
    });

    const config = readProjectConfiguration(tree, 'my-mcp');
    const deps = (
      config.targets?.['mcp-server-dev']?.dependsOn ?? []
    ).filter(
      (d: any) =>
        typeof d === 'object' &&
        d.projects?.includes('db') &&
        d.target === 'dev',
    );
    expect(deps).toHaveLength(1);
  });
});
