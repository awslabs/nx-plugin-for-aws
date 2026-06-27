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
          'dev': { executor: 'nx:run-commands', continuous: true },
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
          'dev': { executor: 'nx:run-commands', continuous: true },
        },
      }),
    );
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should add dynamodb dev dependency to fast-api dev', async () => {
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
    setupDynamoDBProject('test.db');

    tree.write(
      'packages/test.db/pyproject.toml',
      `[project]\nname = "test-db"\nversion = "1.0.0"\ndependencies = []\n`,
    );

    tree.write(
      'packages/api/pyproject.toml',
      `[project]\nname = "test-api"\nversion = "1.0.0"\ndependencies = []\n`,
    );

    await pyDynamoDBFastApiConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'test.db',
    });

    const pyprojectContent = tree.read('packages/api/pyproject.toml', 'utf-8')!;
    // The dependency and [tool.uv.sources] key must be the PEP 503 distribution
    // name (hyphenated) so @nxlv/python infers the workspace dependency edge,
    // not the dotted Nx project id.
    expect(pyprojectContent).toContain('test-db');
    expect(pyprojectContent).not.toContain('test.db');
  });

  it('should not add dependency when source has no dev', async () => {
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
    expect(config.targets?.['dev']).toBeUndefined();
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
    const deps = (config.targets?.['dev']?.dependsOn ?? []).filter(
      (d: any) =>
        typeof d === 'object' &&
        d.projects?.includes('db') &&
        d.target === 'dev',
    );
    expect(deps).toHaveLength(1);
  });
});
