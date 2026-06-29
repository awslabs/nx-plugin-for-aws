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
          dev: { executor: 'nx:run-commands', continuous: true },
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
          [`${mcpServerName}-dev`]: {
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
      sourceComponent: {
        generator: 'py#mcp-server',
        name: 'custom-mcp-server',
      },
    });

    expect(readProjectConfiguration(tree, 'my-mcp-server')).toMatchSnapshot();
  });

  it('should add dynamodb package as workspace dependency to pyproject.toml', async () => {
    setupMcpServerProject();
    setupDynamoDBProject('test.db');

    tree.write(
      'packages/test.db/pyproject.toml',
      `[project]\nname = "test-db"\nversion = "1.0.0"\ndependencies = []\n`,
    );

    tree.write(
      'packages/my-mcp-server/pyproject.toml',
      `[project]\nname = "test-my-mcp-server"\nversion = "1.0.0"\ndependencies = []\n`,
    );

    await pyDynamoDBMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-mcp-server',
      targetProject: 'test.db',
    });

    const pyprojectContent = tree.read(
      'packages/my-mcp-server/pyproject.toml',
      'utf-8',
    )!;
    // The dependency and [tool.uv.sources] key must be the PEP 503 distribution
    // name (hyphenated) so @nxlv/python infers the workspace dependency edge,
    // not the dotted Nx project id.
    expect(pyprojectContent).toContain('test-db');
    expect(pyprojectContent).not.toContain('test.db');
  });

  it('should not add dependency when source has no matching dev', async () => {
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
    expect(config.targets?.['mcp-server-dev']).toBeUndefined();
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
    const deps = (config.targets?.['mcp-server-dev']?.dependsOn ?? []).filter(
      (d: any) =>
        typeof d === 'object' &&
        d.projects?.includes('db') &&
        d.target === 'dev',
    );
    expect(deps).toHaveLength(1);
  });
});
