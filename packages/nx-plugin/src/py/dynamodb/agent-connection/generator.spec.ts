/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readProjectConfiguration, type Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import { pyDynamoDBAgentConnectionGenerator } from './generator';

describe('py#dynamodb agent-connection generator', () => {
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

  const setupAgentProject = (name = 'my-agent', agentName = 'agent') => {
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
      }),
    );
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should add dynamodb dev dependency to agent dev', async () => {
    setupAgentProject();
    setupDynamoDBProject();

    await pyDynamoDBAgentConnectionGenerator(tree, {
      sourceProject: 'my-agent',
      targetProject: 'db',
    });

    expect(readProjectConfiguration(tree, 'my-agent')).toMatchSnapshot();
  });

  it('should use sourceComponent name when provided', async () => {
    setupAgentProject('my-agent', 'custom-agent');
    setupDynamoDBProject();

    await pyDynamoDBAgentConnectionGenerator(tree, {
      sourceProject: 'my-agent',
      targetProject: 'db',
      sourceComponent: { generator: 'py#agent', name: 'custom-agent' },
    });

    expect(readProjectConfiguration(tree, 'my-agent')).toMatchSnapshot();
  });

  it('should add dynamodb package as workspace dependency to pyproject.toml', async () => {
    setupAgentProject();
    setupDynamoDBProject('test.db');

    tree.write(
      'packages/test.db/pyproject.toml',
      `[project]\nname = "test-db"\nversion = "1.0.0"\ndependencies = []\n`,
    );

    tree.write(
      'packages/my-agent/pyproject.toml',
      `[project]\nname = "test-my-agent"\nversion = "1.0.0"\ndependencies = []\n`,
    );

    await pyDynamoDBAgentConnectionGenerator(tree, {
      sourceProject: 'my-agent',
      targetProject: 'test.db',
    });

    const pyprojectContent = tree.read(
      'packages/my-agent/pyproject.toml',
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
      `packages/my-agent/project.json`,
      JSON.stringify({
        name: 'my-agent',
        root: 'packages/my-agent',
        targets: { build: {} },
      }),
    );
    setupDynamoDBProject();

    await pyDynamoDBAgentConnectionGenerator(tree, {
      sourceProject: 'my-agent',
      targetProject: 'db',
    });

    const config = readProjectConfiguration(tree, 'my-agent');
    expect(config.targets?.['agent-dev']).toBeUndefined();
  });

  it('should be idempotent', async () => {
    setupAgentProject();
    setupDynamoDBProject();

    await pyDynamoDBAgentConnectionGenerator(tree, {
      sourceProject: 'my-agent',
      targetProject: 'db',
    });
    await pyDynamoDBAgentConnectionGenerator(tree, {
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
});
