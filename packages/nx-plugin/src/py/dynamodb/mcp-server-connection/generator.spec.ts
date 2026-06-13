/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readProjectConfiguration, type Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import { pyDynamoDBMcpServerConnectionGenerator } from './generator';

describe('py#dynamodb mcp-server-connection generator', () => {
  let tree: Tree;

  const setupDynamoDBProject = (name = 'db') => {
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
    name = 'my-mcp-server',
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
      }),
    );
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should add dynamodb serve-local dependency to mcp-server serve-local', async () => {
    setupMcpServerProject();
    setupDynamoDBProject();

    await pyDynamoDBMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-mcp-server',
      targetProject: 'db',
    });

    expect(readProjectConfiguration(tree, 'my-mcp-server')).toMatchSnapshot();
  });

  it('should use sourceComponent name when provided', async () => {
    setupMcpServerProject('my-mcp-server', 'custom-mcp-server');
    setupDynamoDBProject();

    await pyDynamoDBMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-mcp-server',
      targetProject: 'db',
      sourceComponent: { name: 'custom-mcp-server' },
    });

    expect(readProjectConfiguration(tree, 'my-mcp-server')).toMatchSnapshot();
  });

  it('should not add dependency when source has no matching serve-local', async () => {
    tree.write(
      `packages/my-mcp-server/project.json`,
      JSON.stringify({
        name: 'my-mcp-server',
        root: 'packages/my-mcp-server',
        targets: { build: {} },
      }),
    );
    setupDynamoDBProject();

    await pyDynamoDBMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-mcp-server',
      targetProject: 'db',
    });

    const config = readProjectConfiguration(tree, 'my-mcp-server');
    expect(config.targets?.['mcp-server-serve-local']).toBeUndefined();
  });

  it('should be idempotent', async () => {
    setupMcpServerProject();
    setupDynamoDBProject();

    await pyDynamoDBMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-mcp-server',
      targetProject: 'db',
    });
    await pyDynamoDBMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-mcp-server',
      targetProject: 'db',
    });

    const config = readProjectConfiguration(tree, 'my-mcp-server');
    const deps = (
      config.targets?.['mcp-server-serve-local']?.dependsOn ?? []
    ).filter(
      (d: any) =>
        typeof d === 'object' &&
        d.projects?.includes('db') &&
        d.target === 'serve-local',
    );
    expect(deps).toHaveLength(1);
  });
});
