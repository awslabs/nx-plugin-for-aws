/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readProjectConfiguration, type Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import { pyRdbAgentConnectionGenerator } from './generator';

describe('py#rdb agent-connection generator', () => {
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

  const setupAgentProject = (name = 'my-agent', agentName = 'agent') => {
    tree.write(
      `packages/${name}/project.json`,
      JSON.stringify({
        name,
        root: `packages/${name}`,
        sourceRoot: `packages/${name}/src/proj_${name.replaceAll('-', '_')}`,
        targets: {
          [`${agentName}-dev`]: {
            executor: 'nx:run-commands',
            continuous: true,
          },
        },
      }),
    );

    const agentNameSnakeCase = agentName.replaceAll('-', '_');
    tree.write(
      `packages/${name}/src/proj_${name.replaceAll('-', '_')}/${agentNameSnakeCase}/Dockerfile`,
      `FROM public.ecr.aws/docker/library/python:3.14-slim

WORKDIR /app

COPY . /app

EXPOSE 8080

ENV PYTHONPATH=/app
ENV PATH="/app/bin:\${PATH}"

CMD ["python", "-m", "proj_${name.replaceAll('-', '_')}.${agentNameSnakeCase}.main"]
`,
    );
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should add rdb dev dependency to agent dev', async () => {
    setupAgentProject();
    setupRdbProject();

    await pyRdbAgentConnectionGenerator(tree, {
      sourceProject: 'my-agent',
      targetProject: 'db',
    });

    expect(readProjectConfiguration(tree, 'my-agent')).toMatchSnapshot();
  });

  it('should use sourceComponent name when provided', async () => {
    setupAgentProject('my-agent', 'custom-agent');
    setupRdbProject();

    await pyRdbAgentConnectionGenerator(tree, {
      sourceProject: 'my-agent',
      targetProject: 'db',
      sourceComponent: {
        generator: 'py#agent',
        name: 'custom-agent',
        path: 'src/proj_my_agent/custom_agent',
      },
    });

    expect(readProjectConfiguration(tree, 'my-agent')).toMatchSnapshot();
  });

  it('should add rdb package as workspace dependency to pyproject.toml', async () => {
    setupAgentProject();
    setupRdbProject();

    tree.write(
      'packages/my-agent/pyproject.toml',
      `[project]\nname = "test.my_agent"\nversion = "1.0.0"\ndependencies = []\n`,
    );

    await pyRdbAgentConnectionGenerator(tree, {
      sourceProject: 'my-agent',
      targetProject: 'db',
    });

    expect(tree.read('packages/my-agent/pyproject.toml', 'utf-8')).toContain(
      'db',
    );
  });

  it('should not add dependency when source has no matching dev target', async () => {
    tree.write(
      `packages/my-agent/project.json`,
      JSON.stringify({
        name: 'my-agent',
        root: 'packages/my-agent',
        targets: { build: {} },
      }),
    );
    setupRdbProject();

    await pyRdbAgentConnectionGenerator(tree, {
      sourceProject: 'my-agent',
      targetProject: 'db',
    });

    const config = readProjectConfiguration(tree, 'my-agent');
    expect(config.targets?.['agent-dev']).toBeUndefined();
  });

  it('should be idempotent', async () => {
    setupAgentProject();
    setupRdbProject();

    await pyRdbAgentConnectionGenerator(tree, {
      sourceProject: 'my-agent',
      targetProject: 'db',
    });
    await pyRdbAgentConnectionGenerator(tree, {
      sourceProject: 'my-agent',
      targetProject: 'db',
    });

    const config = readProjectConfiguration(tree, 'my-agent');
    const deps = (config.targets?.['agent-dev']?.dependsOn ?? []).filter(
      (d: any) =>
        typeof d === 'object' &&
        d.projects?.includes('db') &&
        d.target === 'dev',
    );
    expect(deps).toHaveLength(1);
  });

  it('should add RDS CA bundle to Dockerfile', async () => {
    setupAgentProject();
    setupRdbProject();

    await pyRdbAgentConnectionGenerator(tree, {
      sourceProject: 'my-agent',
      targetProject: 'db',
    });

    expect(
      tree.read(
        'packages/my-agent/src/proj_my_agent/agent/Dockerfile',
        'utf-8',
      ),
    ).toMatchSnapshot();
  });

  it('should add RDS CA bundle to sourceComponent Dockerfile', async () => {
    setupAgentProject('my-agent', 'custom-agent');
    setupRdbProject();

    await pyRdbAgentConnectionGenerator(tree, {
      sourceProject: 'my-agent',
      targetProject: 'db',
      sourceComponent: { generator: 'py#agent', name: 'custom-agent' },
    });

    expect(
      tree.read(
        'packages/my-agent/src/proj_my_agent/custom_agent/Dockerfile',
        'utf-8',
      ),
    ).toMatchSnapshot();
  });

  it('should be idempotent for Dockerfile', async () => {
    setupAgentProject();
    setupRdbProject();

    await pyRdbAgentConnectionGenerator(tree, {
      sourceProject: 'my-agent',
      targetProject: 'db',
    });
    await pyRdbAgentConnectionGenerator(tree, {
      sourceProject: 'my-agent',
      targetProject: 'db',
    });

    expect(
      tree.read(
        'packages/my-agent/src/proj_my_agent/agent/Dockerfile',
        'utf-8',
      ),
    ).toMatchSnapshot();
  });
});
