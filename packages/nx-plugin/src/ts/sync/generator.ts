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

  if (!basePaths) {
    return {};
  }

  const changesByConfigFile: Record<string, PathChange[]> = {};

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

      const { changes, updated } = syncPathsWithBase(
        tree,
        tsConfigPath,
        basePaths,
      );

      if (updated) {
        changesByConfigFile[tsConfigPath] = changes;
      }
    }
  }

  if (Object.keys(changesByConfigFile).length === 0) {
    return {};
  }

  await formatFilesInSubtree(tree);

  return {
    outOfSyncMessage: buildOutOfSyncMessage(changesByConfigFile),
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
  return baseConfigJson?.compilerOptions?.paths ?? {};
};

type PathChangeType = 'added' | 'updated';

type PathChange = {
  alias: string;
  type: PathChangeType;
};

const arePathArraysEqual = (first: string[], second: string[]): boolean => {
  if (first.length !== second.length) {
    return false;
  }

  return first.every((value, index) => value === second[index]);
};

const syncPathsWithBase = (
  tree: Tree,
  tsConfigPath: string,
  basePaths: Record<string, string[]>,
): { updated: boolean; changes: PathChange[] } => {
  const changes: PathChange[] = [];

  const tsConfigJson = readJson(tree, tsConfigPath);
  const paths = tsConfigJson?.compilerOptions?.paths;

  if (!paths) {
    return { updated: false, changes };
  }

  const updatedAliases: Record<string, string[]> = {
    ...(tsConfigJson.compilerOptions?.paths ?? {}),
  };
  let updated = false;

  // Add or update aliases that exist in the base config
  for (const [alias, baseValue] of Object.entries(basePaths)) {
    const existingValue = updatedAliases[alias];
    if (!existingValue) {
      changes.push({ alias, type: 'added' });
      updated = true;
    } else if (!arePathArraysEqual(existingValue, baseValue)) {
      changes.push({ alias, type: 'updated' });
      updated = true;
    }

    updatedAliases[alias] = baseValue;
  }

  if (updated) {
    updateJson(tree, tsConfigPath, (json) => ({
      ...json,
      compilerOptions: {
        ...json.compilerOptions,
        paths: updatedAliases,
      },
    }));
  }

  return { updated, changes };
};

/**
 * Build the message to display when the sync generator would make changes to the tree
 */
const buildOutOfSyncMessage = (
  changesByConfig: Record<string, PathChange[]>,
): string =>
  `TypeScript path aliases are out of sync with the base tsconfig. The following configs will be updated:\n${Object.entries(
    changesByConfig,
  )
    .map(
      ([config, changes]) =>
        `${config}:\n${changes
          .slice()
          .sort((left, right) => left.alias.localeCompare(right.alias))
          .map(({ alias, type }) => `- ${alias} (${type})`)
          .join('\n')}`,
    )
    .join('\n\n')}`;
