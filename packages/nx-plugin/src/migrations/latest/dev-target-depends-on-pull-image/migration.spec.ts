/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  type ProjectConfiguration,
  readProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import { PY_DYNAMODB_GENERATOR_INFO } from '../../../py/dynamodb/generator.js';
import { TS_DYNAMODB_GENERATOR_INFO } from '../../../ts/dynamodb/generator.js';
import { TS_RDB_GENERATOR_INFO } from '../../../ts/rdb/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const pullImageTarget = (scriptsDir: string) => ({
  executor: 'nx:run-commands',
  options: {
    command: `tsx ${scriptsDir}/pull-image.ts`,
    cwd: '{projectRoot}',
  },
});

const dynamoDbProject = (): ProjectConfiguration => ({
  name: 'my-table',
  root: 'packages/my-table',
  metadata: { generator: TS_DYNAMODB_GENERATOR_INFO.id } as any,
  targets: {
    'pull-image': pullImageTarget('../common/scripts/src/dynamodb'),
    dev: {
      executor: 'nx:run-commands',
      continuous: true,
      options: {
        commands: [
          'tsx ../common/scripts/src/dynamodb/start-container.ts',
          'tsx ../common/scripts/src/dynamodb/create-local-table.ts',
        ],
        parallel: true,
        cwd: '{projectRoot}',
      },
    },
  },
});

const rdbProject = (): ProjectConfiguration => ({
  name: 'my-db',
  root: 'packages/my-db',
  metadata: { generator: TS_RDB_GENERATOR_INFO.id } as any,
  targets: {
    'pull-image': pullImageTarget('../common/scripts/src/rdb'),
    dev: {
      executor: 'nx:run-commands',
      options: {
        command: 'tsx ../common/scripts/src/rdb/start-container.ts',
        cwd: '{projectRoot}',
      },
      continuous: true,
    },
    'wait-for-db': {
      executor: 'nx:run-commands',
      dependsOn: ['dev'],
      options: {
        command: 'tsx ../common/scripts/src/rdb/wait-for-postgres-db.ts',
        cwd: '{projectRoot}',
      },
    },
  },
});

describe('dev-target-depends-on-pull-image migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should add pull-image to a ts#dynamodb dev target', async () => {
    addProjectConfiguration(tree, 'my-table', dynamoDbProject());

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(0);
    expect(readProjectConfiguration(tree, 'my-table').targets.dev).toEqual({
      executor: 'nx:run-commands',
      dependsOn: ['pull-image'],
      continuous: true,
      options: {
        commands: [
          'tsx ../common/scripts/src/dynamodb/start-container.ts',
          'tsx ../common/scripts/src/dynamodb/create-local-table.ts',
        ],
        parallel: true,
        cwd: '{projectRoot}',
      },
    });
  });

  it('should add pull-image to a ts#rdb dev target and leave its dependents alone', async () => {
    addProjectConfiguration(tree, 'my-db', rdbProject());

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(0);
    const { targets } = readProjectConfiguration(tree, 'my-db');
    expect(targets.dev.dependsOn).toEqual(['pull-image']);
    expect(targets['wait-for-db'].dependsOn).toEqual(['dev']);
  });

  it('should order dev target keys the way nx serializes them', async () => {
    addProjectConfiguration(tree, 'my-table', dynamoDbProject());

    await migration(tree);

    expect(
      Object.keys(readProjectConfiguration(tree, 'my-table').targets.dev),
    ).toEqual(['executor', 'dependsOn', 'continuous', 'options']);
  });

  it('should preserve existing dependsOn entries', async () => {
    const project = dynamoDbProject();
    project.targets.dev.dependsOn = ['^build'];
    addProjectConfiguration(tree, 'my-table', project);

    await migration(tree);

    expect(
      readProjectConfiguration(tree, 'my-table').targets.dev.dependsOn,
    ).toEqual(['pull-image', '^build']);
  });

  it('should skip and report a customised dev target', async () => {
    const project = dynamoDbProject();
    project.targets.dev.options = {
      commands: ['docker compose up'],
      cwd: '{projectRoot}',
    };
    addProjectConfiguration(tree, 'my-table', project);

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0]).toContain('my-table');
    expect(
      readProjectConfiguration(tree, 'my-table').targets.dev.dependsOn,
    ).toBeUndefined();
  });

  it('should leave projects from other generators alone', async () => {
    const project = dynamoDbProject();
    project.metadata = { generator: PY_DYNAMODB_GENERATOR_INFO.id } as any;
    addProjectConfiguration(tree, 'my-table', project);

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(0);
    expect(
      readProjectConfiguration(tree, 'my-table').targets.dev.dependsOn,
    ).toBeUndefined();
  });

  it('should skip a project without a pull-image target', async () => {
    const project = dynamoDbProject();
    delete project.targets['pull-image'];
    addProjectConfiguration(tree, 'my-table', project);

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(0);
    expect(
      readProjectConfiguration(tree, 'my-table').targets.dev.dependsOn,
    ).toBeUndefined();
  });

  it('should be idempotent', async () => {
    addProjectConfiguration(tree, 'my-table', dynamoDbProject());
    addProjectConfiguration(tree, 'my-db', rdbProject());

    await migration(tree);
    const afterFirst = tree.read('packages/my-table/project.json', 'utf-8');

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(0);
    expect(tree.read('packages/my-table/project.json', 'utf-8')).toEqual(
      afterFirst,
    );
    expect(
      readProjectConfiguration(tree, 'my-table').targets.dev.dependsOn,
    ).toEqual(['pull-image']);
  });
});
