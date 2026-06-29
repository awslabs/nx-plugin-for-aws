/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readProjectConfiguration, type Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import { tsDynamoDBSmithyConnectionGenerator } from './generator';

describe('ts#dynamodb smithy-connection generator', () => {
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

  const setupSmithyProject = (name = 'api') => {
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

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should add dynamodb dev dependency to smithy dev', async () => {
    setupSmithyProject();
    setupDynamoDBProject();

    await tsDynamoDBSmithyConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });

    expect(readProjectConfiguration(tree, 'api')).toMatchSnapshot();
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

    await tsDynamoDBSmithyConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });

    const config = readProjectConfiguration(tree, 'api');
    expect(config.targets?.['dev']).toBeUndefined();
  });

  it('should be idempotent', async () => {
    setupSmithyProject();
    setupDynamoDBProject();

    await tsDynamoDBSmithyConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'db',
    });
    await tsDynamoDBSmithyConnectionGenerator(tree, {
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
