/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Tree,
  getProjects,
  joinPathFragments,
  readJson,
  updateJson,
} from '@nx/devkit';
import { NxGeneratorInfo, getGeneratorInfo } from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { formatFilesInSubtree } from '../../utils/format';
import { SyncGeneratorResult } from 'nx/src/utils/sync-generators';
import PackageJson from '../../../package.json';

export const TS_SYNC_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const SYNC_GENERATOR_NAME = `${PackageJson.name}:${TS_SYNC_GENERATOR_INFO.id}`;

export const syncGeneratorGenerator = async (
  tree: Tree,
): Promise<SyncGeneratorResult> => {
  const basePaths = readBaseTsConfigPaths(tree);

  await addGeneratorMetricsIfApplicable(tree, [TS_SYNC_GENERATOR_INFO]);

  if (!basePaths || Object.keys(basePaths).length === 0) {
    return {};
  }

  const addedPathsByConfig: Record<string, string[]> = {};

  for (const project of getProjects(tree).values()) {
    for (const tsConfigFileName of [
      'tsconfig.json',
      'tsconfig.lib.json',
      'tsconfig.app.json',
    ]) {
      const tsConfigPath = joinPathFragments(project.root, tsConfigFileName);
      if (!tree.exists(tsConfigPath)) {
        continue;
      }

      const addedAliases = addBasePathsIfMissing(tree, tsConfigPath, basePaths);
      if (addedAliases.length > 0) {
        addedPathsByConfig[tsConfigPath] = addedAliases;
      }
    }
  }

  if (Object.keys(addedPathsByConfig).length === 0) {
    return {};
  }

  await formatFilesInSubtree(tree);

  return {
    outOfSyncMessage: buildOutOfSyncMessage(addedPathsByConfig),
  };
};

export default syncGeneratorGenerator;

const readBaseTsConfigPaths = (
  tree: Tree,
): Record<string, string[]> | undefined => {
  const baseConfigPath = ['tsconfig.base.json', 'tsconfig.json'].find((path) =>
    tree.exists(path),
  );

  if (!baseConfigPath) {
    return undefined;
  }

  const baseConfig = readJson<Record<string, any>>(tree, baseConfigPath);
  return baseConfig?.compilerOptions?.paths;
};

const addBasePathsIfMissing = (
  tree: Tree,
  tsconfigPath: string,
  basePaths: Record<string, string[]>,
): string[] => {
  const addedAliases: string[] = [];

  updateJson(tree, tsconfigPath, (json) => {
    const paths = json?.compilerOptions?.paths;

    if (!paths) {
      return json;
    }

    const missingEntries = Object.entries(basePaths).filter(
      ([alias]) => !(alias in paths),
    );

    if (missingEntries.length === 0) {
      return json;
    }

    addedAliases.push(...missingEntries.map(([alias]) => alias));

    return {
      ...json,
      compilerOptions: {
        ...json.compilerOptions,
        paths: {
          ...paths,
          ...Object.fromEntries(missingEntries),
        },
      },
    };
  });

  return addedAliases;
};

/**
 * Build the message to display when the sync generator would make changes to the tree
 */
const buildOutOfSyncMessage = (addedPaths: Record<string, string[]>): string =>
  `TypeScript path aliases are out of sync with the base tsconfig. The following configs were updated:\n${Object.entries(
    addedPaths,
  )
    .map(
      ([config, aliases]) =>
        `${config}:\n${aliases.map((alias) => `- ${alias}`).join('\n')}`,
    )
    .join('\n\n')}`;
