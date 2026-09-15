/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { joinPathFragments, readJson, type Tree, writeJson } from '@nx/devkit';

/** A Global Secondary Index as `config.json` declares it. */
export interface DynamoDBGlobalSecondaryIndex {
  readonly indexName: string;
  readonly partitionKey: string;
  readonly sortKey?: string;
}

export interface DynamoDBLocalDevConfig {
  readonly port: number;
  readonly tableName: string;
  readonly image: string;
  readonly containerName: string;
  readonly containerEngine: string;
}

export interface DynamoDBConfig {
  runtimeConfigKey: string;
  localDev: DynamoDBLocalDevConfig;
  tableConfig: { globalSecondaryIndexes: DynamoDBGlobalSecondaryIndex[] };
}

/** The image the local DynamoDB container runs. */
export const DYNAMODB_LOCAL_IMAGE =
  'public.ecr.aws/aws-dynamodb-local/aws-dynamodb-local:latest';

/**
 * The two overloadable GSIs a new table starts with, following the single-table
 * design naming convention the guides describe.
 */
export const DEFAULT_GLOBAL_SECONDARY_INDEXES: DynamoDBGlobalSecondaryIndex[] =
  [
    {
      indexName: 'gsi1pk-gsi1sk-index',
      partitionKey: 'gsi1pk',
      sortKey: 'gsi1sk',
    },
    {
      indexName: 'gsi2pk-gsi2sk-index',
      partitionKey: 'gsi2pk',
      sortKey: 'gsi2sk',
    },
  ];

/**
 * Write a DynamoDB project's `config.json`.
 *
 * The file has two halves with different owners, so it is merged rather than
 * re-emitted whole:
 *
 * - `runtimeConfigKey` and `localDev` are derived from the generator's options,
 *   so they converge on a re-run — changing `--tableName` still takes effect.
 * - `tableConfig.globalSecondaryIndexes` is the user's, since the guides tell
 *   them to add an entry per GSI. The defaults seed a new project; an existing
 *   list is carried through untouched.
 */
export const writeDynamoDBConfig = (
  tree: Tree,
  projectRoot: string,
  config: {
    runtimeConfigKey: string;
    localDev: DynamoDBLocalDevConfig;
  },
): void => {
  const configPath = joinPathFragments(projectRoot, 'config.json');
  const existing: Partial<DynamoDBConfig> = tree.exists(configPath)
    ? readJson(tree, configPath)
    : {};

  writeJson(tree, configPath, {
    runtimeConfigKey: config.runtimeConfigKey,
    localDev: config.localDev,
    tableConfig: {
      globalSecondaryIndexes:
        existing.tableConfig?.globalSecondaryIndexes ??
        DEFAULT_GLOBAL_SECONDARY_INDEXES,
    },
  } satisfies DynamoDBConfig);
};
