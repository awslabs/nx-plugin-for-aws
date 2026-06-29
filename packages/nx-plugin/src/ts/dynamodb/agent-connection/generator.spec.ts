/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readProjectConfiguration, type Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import { tsDynamoDBAgentConnectionGenerator } from './generator';

describe('ts#dynamodb agent-connection generator', () => {
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

    await tsDynamoDBAgentConnectionGenerator(tree, {
      sourceProject: 'my-agent',
      targetProject: 'db',
    });

    expect(readProjectConfiguration(tree, 'my-agent')).toMatchSnapshot();
  });

  it('should use sourceComponent name when provided', async () => {
    setupAgentProject('my-agent', 'custom-agent');
    setupDynamoDBProject();

    await tsDynamoDBAgentConnectionGenerator(tree, {
      sourceProject: 'my-agent',
      targetProject: 'db',
      sourceComponent: { name: 'custom-agent' },
    });

    expect(readProjectConfiguration(tree, 'my-agent')).toMatchSnapshot();
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

    await tsDynamoDBAgentConnectionGenerator(tree, {
      sourceProject: 'my-agent',
      targetProject: 'db',
    });

    const config = readProjectConfiguration(tree, 'my-agent');
    expect(config.targets?.['agent-dev']).toBeUndefined();
  });

  it('should be idempotent', async () => {
    setupAgentProject();
    setupDynamoDBProject();

    await tsDynamoDBAgentConnectionGenerator(tree, {
      sourceProject: 'my-agent',
      targetProject: 'db',
    });
    await tsDynamoDBAgentConnectionGenerator(tree, {
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
