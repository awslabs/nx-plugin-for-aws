/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readProjectConfiguration, type Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import { pyDynamoDBFastApiConnectionGenerator } from './generator';

describe('py#dynamodb fast-api-connection generator', () => {
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

  const setupFastApiProject = (name = 'api') => {
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

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should add dynamodb serve-local dependency to fast-api serve-local', async () => {
    setupFastApiProject();
    setupDynamoDBProject();

    await pyDynamoDBFastApiConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });

    expect(readProjectConfiguration(tree, 'api')).toMatchSnapshot();
  });

  it('should add dynamodb package as workspace dependency to pyproject.toml', async () => {
    setupFastApiProject();
    setupDynamoDBProject();

    tree.write(
      'packages/api/pyproject.toml',
      `[project]\nname = "test.api"\nversion = "1.0.0"\ndependencies = []\n`,
    );

    await pyDynamoDBFastApiConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });

    const pyprojectContent = tree.read('packages/api/pyproject.toml', 'utf-8')!;
    expect(pyprojectContent).toContain('db');
  });

  it('should not add dependency when source has no serve-local', async () => {
    tree.write(
      `packages/api/project.json`,
      JSON.stringify({
        name: 'api',
        root: 'packages/api',
        targets: { build: {} },
      }),
    );
    setupDynamoDBProject();

    await pyDynamoDBFastApiConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });

    const config = readProjectConfiguration(tree, 'api');
    expect(config.targets?.['serve-local']).toBeUndefined();
  });

  it('should be idempotent', async () => {
    setupFastApiProject();
    setupDynamoDBProject();

    await pyDynamoDBFastApiConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });
    await pyDynamoDBFastApiConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });

    const config = readProjectConfiguration(tree, 'api');
    const deps = (config.targets?.['serve-local']?.dependsOn ?? []).filter(
      (d: any) =>
        typeof d === 'object' &&
        d.projects?.includes('db') &&
        d.target === 'serve-local',
    );
    expect(deps).toHaveLength(1);
  });
});
