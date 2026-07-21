/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createProjectGraphAsync,
  getProjects,
  joinPathFragments,
  type ProjectGraph,
  readJson,
  type Tree,
  updateJson,
} from '@nx/devkit';
import type { SyncGeneratorResult } from 'nx/src/utils/sync-generators';
import { relative } from 'path';
import PackageJson from '../../../package.json' with { type: 'json' };
import { getLocalDependencySpecifier } from '../../utils/dependencies';
import { getGeneratorInfo, type NxGeneratorInfo } from '../../utils/nx';

export const TS_SYNC_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

export const SYNC_GENERATOR_NAME = `${PackageJson.name}:${TS_SYNC_GENERATOR_INFO.id}`;

export const tsSyncGeneratorGenerator = async (
  tree: Tree,
  // The sync runner invokes with only the tree; `nx g` passes an options
  // object and treats any truthy return value as a task callback — so when
  // options are present, return nothing instead of a SyncGeneratorResult.
  options?: unknown,
): Promise<SyncGeneratorResult | undefined> => {
  const asResult = (
    result: SyncGeneratorResult,
  ): SyncGeneratorResult | undefined =>
    options === undefined ? result : undefined;

  const basePaths = readBaseTsConfigPaths(tree);

  if (!basePaths) {
    return asResult({});
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
        project.root,
      );

      if (updated) {
        changesByConfigFile[tsConfigPath] = changes;
      }
    }
  }

  const localSpecifier = getLocalDependencySpecifier(tree);
  const localDepChanges = await syncLocalProjectDependencies(
    tree,
    localSpecifier,
  );

  const messages: string[] = [];
  if (Object.keys(changesByConfigFile).length > 0) {
    messages.push(buildOutOfSyncMessage(changesByConfigFile));
  }
  if (Object.keys(localDepChanges).length > 0) {
    messages.push(
      buildLocalDepOutOfSyncMessage(localDepChanges, localSpecifier),
    );
  }

  if (messages.length === 0) {
    return asResult({});
  }

  return asResult({
    outOfSyncMessage: messages.join('\n\n'),
  });
};

/**
 * Ensure every project declares the workspace projects it depends on in its
 * own package.json, using the package manager's local-dependency specifier
 * (`workspace:*` where the workspace protocol is supported, `*` otherwise).
 *
 * Cross-project imports resolve through the tsconfig path aliases, but the
 * `noUndeclaredDependencies` lint rule (and standard tooling) expects a project
 * to declare the local packages it uses. The dependency edges come from the Nx
 * project graph — the same import analysis Nx's own `@nx/js:typescript-sync`
 * uses to wire tsconfig references — so users get these maintained
 * automatically rather than declaring each by hand. Returns the packages added
 * per project manifest.
 */
const syncLocalProjectDependencies = async (
  tree: Tree,
  localSpecifier: string,
): Promise<Record<string, string[]>> => {
  const projectGraph = await createProjectGraphAsync();

  // Map each workspace project to the package.json name + path derived from its
  // graph node root, so graph edges (keyed by project name) resolve to the
  // manifest we declare the dependency in.
  const projectInfoByName = collectProjectInfo(tree, projectGraph);

  const addedByManifest: Record<string, string[]> = {};

  for (const [projectName, info] of projectInfoByName) {
    // Local workspace projects this one depends on (excludes external npm
    // packages, which have no graph node, and implicit edges).
    const dependencyNames = (projectGraph.dependencies[projectName] ?? [])
      .filter(
        (dep) =>
          dep.type !== 'implicit' &&
          projectInfoByName.has(dep.target) &&
          dep.target !== projectName,
      )
      .map((dep) => projectInfoByName.get(dep.target)!.packageName);

    if (dependencyNames.length === 0) {
      continue;
    }

    const added: string[] = [];
    updateJson(tree, info.packageJsonPath, (json) => {
      const dependencies = { ...(json.dependencies ?? {}) };
      const devDependencies = json.devDependencies ?? {};
      for (const name of [...new Set(dependencyNames)].sort()) {
        // Already declared (in either dependency list) — leave as-is.
        if (dependencies[name] || devDependencies[name]) {
          continue;
        }
        dependencies[name] = localSpecifier;
        added.push(name);
      }
      return added.length > 0 ? { ...json, dependencies } : json;
    });

    if (added.length > 0) {
      addedByManifest[info.packageJsonPath] = added;
    }
  }

  return addedByManifest;
};

interface ProjectInfo {
  packageName: string;
  packageJsonPath: string;
}

/**
 * Index every graph node that is a workspace project with a named package.json
 * by its project name, resolving the manifest from the node's root.
 */
const collectProjectInfo = (
  tree: Tree,
  projectGraph: ProjectGraph,
): Map<string, ProjectInfo> => {
  const infoByName = new Map<string, ProjectInfo>();
  for (const [name, node] of Object.entries(projectGraph.nodes)) {
    const root = node.data.root;
    if (!root) {
      continue;
    }
    const packageJsonPath = joinPathFragments(root, 'package.json');
    if (!tree.exists(packageJsonPath)) {
      continue;
    }
    const packageName = readJson<{ name?: string }>(tree, packageJsonPath).name;
    if (packageName) {
      infoByName.set(name, { packageName, packageJsonPath });
    }
  }
  return infoByName;
};

const buildLocalDepOutOfSyncMessage = (
  addedByManifest: Record<string, string[]>,
  localSpecifier: string,
): string =>
  `Local project dependencies are out of sync. The following workspace dependencies will be declared:\n${Object.entries(
    addedByManifest,
  )
    .map(
      ([manifest, names]) =>
        `${manifest}:\n${names
          .map((name) => `- ${name}: ${localSpecifier}`)
          .join('\n')}`,
    )
    .join('\n\n')}`;

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

/**
 * Rebase a path from the workspace root to a project root.
 * e.g. "./packages/foo/src/index.ts" from project "packages/bar"
 *      becomes "../../packages/foo/src/index.ts"
 */
const rebasePath = (pathValue: string, projectRoot: string): string => {
  // Strip leading ./ if present
  const normalized = pathValue.startsWith('./')
    ? pathValue.slice(2)
    : pathValue;
  const relPrefix = relative(projectRoot, '.') || '.';
  return joinPathFragments(relPrefix, normalized);
};

const syncPathsWithBase = (
  tree: Tree,
  tsConfigPath: string,
  basePaths: Record<string, string[]>,
  projectRoot: string,
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

  // Add or update aliases that exist in the base config, rebasing paths
  // relative to the project root since baseUrl is no longer set
  for (const [alias, baseValue] of Object.entries(basePaths)) {
    const rebasedValue = (baseValue as string[]).map((p) =>
      rebasePath(p, projectRoot),
    );
    const existingValue = updatedAliases[alias];
    if (!existingValue) {
      changes.push({ alias, type: 'added' });
      updated = true;
    } else if (!arePathArraysEqual(existingValue, rebasedValue)) {
      changes.push({ alias, type: 'updated' });
      updated = true;
    }

    updatedAliases[alias] = rebasedValue;
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
