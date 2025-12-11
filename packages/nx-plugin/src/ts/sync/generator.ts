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
import { formatFilesInSubtree } from '../../utils/format';
import { SyncGeneratorResult } from 'nx/src/utils/sync-generators';
import PackageJson from '../../../package.json';

export const TS_SYNC_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const SYNC_GENERATOR_NAME = `${PackageJson.name}:${TS_SYNC_GENERATOR_INFO.id}`;

export const tsSyncGeneratorGenerator = async (
  tree: Tree,
): Promise<SyncGeneratorResult> => {
  const basePaths = readBaseTsConfigPaths(tree);

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

export default tsSyncGeneratorGenerator;

const readBaseTsConfigPaths = (
  tree: Tree,
): Record<string, string[]> | undefined => {
  const baseConfigPath = ['tsconfig.base.json', 'tsconfig.json'].find((path) =>
    tree.exists(path),
  );

  if (!baseConfigPath) {
    return undefined;
  }

  const baseConfigJson = readJson<Record<string, any>>(tree, baseConfigPath);
  return baseConfigJson?.compilerOptions?.paths;
};

const addBasePathsIfMissing = (
  tree: Tree,
  tsConfigPath: string,
  basePaths: Record<string, string[]>,
): string[] => {
  const addedAliases: string[] = [];

  const tsConfigJson = readJson(tree, tsConfigPath);
  const paths = tsConfigJson?.compilerOptions?.paths;

  if (!paths) {
    return addedAliases;
  }

  const projectPathAliases = new Set(Object.keys(paths));
  const missingEntries = Object.entries(basePaths).filter(
    ([alias]) => !projectPathAliases.has(alias),
  );

  if (missingEntries.length === 0) {
    return addedAliases;
  }

  updateJson(tree, tsConfigPath, (json) => {
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
  `TypeScript path aliases are out of sync with the base tsconfig. The following configs will be updated:\n${Object.entries(
    addedPaths,
  )
    .map(
      ([config, aliases]) =>
        `${config}:\n${aliases.map((alias) => `- ${alias}`).join('\n')}`,
    )
    .join('\n\n')}`;
