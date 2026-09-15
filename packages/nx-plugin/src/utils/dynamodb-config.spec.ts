/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, type Tree, writeJson } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_GLOBAL_SECONDARY_INDEXES,
  DYNAMODB_LOCAL_IMAGE,
  writeDynamoDBConfig,
} from './dynamodb-config.js';

describe('writeDynamoDBConfig', () => {
  let tree: Tree;

  const localDev = {
    port: 8000,
    tableName: 'proj-my-table',
    image: DYNAMODB_LOCAL_IMAGE,
    containerName: 'proj-dynamodb',
    containerEngine: 'docker',
  };

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('should seed a new project with the default GSIs', () => {
    writeDynamoDBConfig(tree, 'packages/my-table', {
      runtimeConfigKey: 'MyTable',
      localDev,
    });

    expect(readJson(tree, 'packages/my-table/config.json')).toEqual({
      runtimeConfigKey: 'MyTable',
      localDev,
      tableConfig: {
        globalSecondaryIndexes: DEFAULT_GLOBAL_SECONDARY_INDEXES,
      },
    });
  });

  it('should preserve the user’s GSI list while converging localDev', () => {
    const userIndexes = [
      { indexName: 'gsi1pk-gsi1sk-index', partitionKey: 'gsi1pk' },
      { indexName: 'gsi9pk-index', partitionKey: 'gsi9pk' },
    ];
    writeJson(tree, 'packages/my-table/config.json', {
      runtimeConfigKey: 'Stale',
      localDev: { ...localDev, tableName: 'stale' },
      tableConfig: { globalSecondaryIndexes: userIndexes },
    });

    writeDynamoDBConfig(tree, 'packages/my-table', {
      runtimeConfigKey: 'MyTable',
      localDev,
    });

    const written = readJson(tree, 'packages/my-table/config.json');
    expect(written.tableConfig.globalSecondaryIndexes).toEqual(userIndexes);
    expect(written.runtimeConfigKey).toBe('MyTable');
    expect(written.localDev.tableName).toBe('proj-my-table');
  });

  it('should seed the defaults when an existing config declares no GSIs', () => {
    writeJson(tree, 'packages/my-table/config.json', {
      runtimeConfigKey: 'MyTable',
      localDev,
    });

    writeDynamoDBConfig(tree, 'packages/my-table', {
      runtimeConfigKey: 'MyTable',
      localDev,
    });

    expect(
      readJson(tree, 'packages/my-table/config.json').tableConfig
        .globalSecondaryIndexes,
    ).toEqual(DEFAULT_GLOBAL_SECONDARY_INDEXES);
  });

  it('should preserve an empty GSI list', () => {
    // Removing every GSI is a legitimate choice, so it must not be re-seeded.
    writeJson(tree, 'packages/my-table/config.json', {
      runtimeConfigKey: 'MyTable',
      localDev,
      tableConfig: { globalSecondaryIndexes: [] },
    });

    writeDynamoDBConfig(tree, 'packages/my-table', {
      runtimeConfigKey: 'MyTable',
      localDev,
    });

    expect(
      readJson(tree, 'packages/my-table/config.json').tableConfig
        .globalSecondaryIndexes,
    ).toEqual([]);
  });
});
