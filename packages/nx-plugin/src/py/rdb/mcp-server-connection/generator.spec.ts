/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readProjectConfiguration, type Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import { pyRdbMcpServerConnectionGenerator } from './generator';

describe('py#rdb mcp-server-connection generator', () => {
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
    name = 'my-mcp-server',
    mcpServerName = 'mcp-server',
  ) => {
    tree.write(
      `packages/${name}/project.json`,
      JSON.stringify({
        name,
        root: `packages/${name}`,
        sourceRoot: `packages/${name}/src/proj_${name.replaceAll('-', '_')}`,
        targets: {
          [`${mcpServerName}-dev`]: {
            executor: 'nx:run-commands',
            continuous: true,
          },
        },
      }),
    );

    const mcpServerNameSnakeCase = mcpServerName.replaceAll('-', '_');
    tree.write(
      `packages/${name}/src/proj_${name.replaceAll('-', '_')}/${mcpServerNameSnakeCase}/Dockerfile`,
      `FROM public.ecr.aws/docker/library/python:3.14-slim

WORKDIR /app

COPY . /app

EXPOSE 8000

ENV PYTHONPATH=/app

CMD ["python", "-m", "uvicorn", "proj_${name.replaceAll('-', '_')}.${mcpServerNameSnakeCase}.http:app", "--host", "0.0.0.0", "--port", "8000"]
`,
    );
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should add rdb dev dependency to mcp-server dev', async () => {
    setupMcpServerProject();
    setupRdbProject();

    await pyRdbMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-mcp-server',
      targetProject: 'db',
    });

    expect(readProjectConfiguration(tree, 'my-mcp-server')).toMatchSnapshot();
  });

  it('should use sourceComponent name when provided', async () => {
    setupMcpServerProject('my-mcp-server', 'custom-mcp-server');
    setupRdbProject();

    await pyRdbMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-mcp-server',
      targetProject: 'db',
      sourceComponent: {
        generator: 'py#mcp-server',
        name: 'custom-mcp-server',
      },
    });

    expect(readProjectConfiguration(tree, 'my-mcp-server')).toMatchSnapshot();
  });

  it('should add rdb package as workspace dependency to pyproject.toml', async () => {
    setupMcpServerProject();
    setupRdbProject();

    tree.write(
      'packages/my-mcp-server/pyproject.toml',
      `[project]\nname = "test.my_mcp_server"\nversion = "1.0.0"\ndependencies = []\n`,
    );

    await pyRdbMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-mcp-server',
      targetProject: 'db',
    });

    expect(
      tree.read('packages/my-mcp-server/pyproject.toml', 'utf-8'),
    ).toContain('db');
  });

  it('should not add dependency when source has no matching dev target', async () => {
    tree.write(
      `packages/my-mcp-server/project.json`,
      JSON.stringify({
        name: 'my-mcp-server',
        root: 'packages/my-mcp-server',
        targets: { build: {} },
      }),
    );
    setupRdbProject();

    await pyRdbMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-mcp-server',
      targetProject: 'db',
    });

    const config = readProjectConfiguration(tree, 'my-mcp-server');
    expect(config.targets?.['mcp-server-dev']).toBeUndefined();
  });

  it('should be idempotent', async () => {
    setupMcpServerProject();
    setupRdbProject();

    await pyRdbMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-mcp-server',
      targetProject: 'db',
    });
    await pyRdbMcpServerConnectionGenerator(tree, {
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

  it('should add RDS CA bundle to Dockerfile', async () => {
    setupMcpServerProject();
    setupRdbProject();

    await pyRdbMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-mcp-server',
      targetProject: 'db',
    });

    expect(
      tree.read(
        'packages/my-mcp-server/src/proj_my_mcp_server/mcp_server/Dockerfile',
        'utf-8',
      ),
    ).toMatchSnapshot();
  });

  it('should add RDS CA bundle to sourceComponent Dockerfile', async () => {
    setupMcpServerProject('my-mcp-server', 'custom-mcp-server');
    setupRdbProject();

    await pyRdbMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-mcp-server',
      targetProject: 'db',
      sourceComponent: {
        generator: 'py#mcp-server',
        name: 'custom-mcp-server',
        path: 'src/proj_my_mcp_server/custom_mcp_server',
      },
    });

    expect(
      tree.read(
        'packages/my-mcp-server/src/proj_my_mcp_server/custom_mcp_server/Dockerfile',
        'utf-8',
      ),
    ).toMatchSnapshot();
  });

  it('should be idempotent for Dockerfile', async () => {
    setupMcpServerProject();
    setupRdbProject();

    await pyRdbMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-mcp-server',
      targetProject: 'db',
    });
    await pyRdbMcpServerConnectionGenerator(tree, {
      sourceProject: 'my-mcp-server',
      targetProject: 'db',
    });

    expect(
      tree.read(
        'packages/my-mcp-server/src/proj_my_mcp_server/mcp_server/Dockerfile',
        'utf-8',
      ),
    ).toMatchSnapshot();
  });
});
