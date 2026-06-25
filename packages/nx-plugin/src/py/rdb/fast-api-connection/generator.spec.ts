/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readProjectConfiguration, type Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import { pyRdbFastApiConnectionGenerator } from './generator';

describe('py#rdb fast-api-connection generator', () => {
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

  const setupFastApiProject = (name = 'api', apiName = 'api') => {
    tree.write(
      `packages/${name}/project.json`,
      JSON.stringify({
        name,
        root: `packages/${name}`,
        metadata: { apiName },
        targets: {
          'serve-local': { executor: 'nx:run-commands', continuous: true },
        },
      }),
    );
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should add rdb serve-local dependency to fast-api serve-local', async () => {
    setupFastApiProject();
    setupRdbProject();

    await pyRdbFastApiConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });

    expect(readProjectConfiguration(tree, 'api')).toMatchSnapshot();
  });

  it('should add rdb package as workspace dependency to pyproject.toml', async () => {
    setupFastApiProject();
    setupRdbProject();

    tree.write(
      'packages/api/pyproject.toml',
      `[project]\nname = "test.api"\nversion = "1.0.0"\ndependencies = []\n`,
    );

    await pyRdbFastApiConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });

    expect(tree.read('packages/api/pyproject.toml', 'utf-8')).toContain('db');
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
    setupRdbProject();

    await pyRdbFastApiConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });

    const config = readProjectConfiguration(tree, 'api');
    expect(config.targets?.['serve-local']).toBeUndefined();
  });

  it('should generate SessionDep dependency file', async () => {
    setupFastApiProject();
    setupRdbProject();

    await pyRdbFastApiConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });

    expect(
      tree.read('packages/api/proj_api/dependencies/db.py', 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should be idempotent', async () => {
    setupFastApiProject();
    setupRdbProject();

    await pyRdbFastApiConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });
    await pyRdbFastApiConnectionGenerator(tree, {
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
