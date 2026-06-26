/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  type ProjectConfiguration,
  readProjectConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import * as path from 'path';
import PackageJson from '../../package.json';
import { toSnakeCase } from './names';
import { getNpmScope, getNpmScopePrefix } from './npm-scope';

export type { GeneratorInfo, NxGeneratorInfo } from './generators';
export { buildGeneratorInfoList } from './generators';

import { buildGeneratorInfoList, type GeneratorInfo } from './generators';

const GENERATORS = buildGeneratorInfoList(path.resolve(__dirname, '..', '..'));

/**
 * List Nx Plugin for AWS generators
 * @param includeHidden include hidden generators (default false)
 */
export const listGenerators = (includeHidden = false) =>
  GENERATORS.filter((g) => includeHidden || !g.hidden);

/**
 * Return generator information. Call this from a generator method with __filename
 */
export const getGeneratorInfo = (generatorFileName: string): GeneratorInfo => {
  const { dir, name } = path.parse(path.resolve(generatorFileName));
  const resolvedFactoryPath = path.join(dir, name);
  return GENERATORS.find(
    (generatorInfo) =>
      generatorInfo.resolvedFactoryPath === resolvedFactoryPath,
  );
};

export const getPackageVersion = () => {
  return PackageJson.version;
};

/**
 * Read a project configuration where the project name may not be fully qualified (ie may omit the scope prefix)
 */
export const readProjectConfigurationUnqualified = (
  tree: Tree,
  projectName: string,
) => {
  try {
    return readProjectConfiguration(tree, projectName);
  } catch (e) {
    // Attempt to find the project without the scope
    const project = [...getProjects(tree).values()].find(
      (p) =>
        p.name &&
        (p.name === `${getNpmScopePrefix(tree)}${projectName}` || // TypeScript fully-qualified name
          p.name === `${toSnakeCase(getNpmScope(tree))}.${projectName}`), // Python fully-qualified name
    );
    if (project) {
      return project;
    }
    throw e;
  }
};

/**
 * Returns whether a project with the given name already exists in the workspace.
 * The project name may be unqualified (ie may omit the scope prefix).
 */
export const projectExists = (tree: Tree, projectName: string): boolean => {
  try {
    readProjectConfigurationUnqualified(tree, projectName);
    return true;
  } catch {
    return false;
  }
};

/**
 * Add metadata about the generator that generated the project to the project.json
 */
export const addGeneratorMetadata = (
  tree: Tree,
  projectName: string,
  info: { id: string },
  additionalMetadata?: { [key: string]: any },
) => {
  const config = readProjectConfigurationUnqualified(tree, projectName);
  const metadata = {
    ...config?.metadata,
    generator: info.id,
    ...additionalMetadata,
  };
  // Skip the write when nothing changed so re-running doesn't reserialize
  // project.json. metadata is plain JSON built in a fixed key order, so a
  // stringify comparison is exact here.
  if (JSON.stringify(config?.metadata) === JSON.stringify(metadata)) {
    return;
  }
  // Place metadata immediately before targets so the serialized key order is
  // identical whether or not metadata already existed (matching the order Nx
  // normalizes a read config to), keeping the change a pure metadata insert.
  const { targets, ...rest } = config;
  updateProjectConfiguration(tree, config.name, {
    ...rest,
    metadata: metadata as any,
    ...(targets ? { targets } : {}),
  });
};

/**
 * Represents a component entry in project metadata
 */
export interface ComponentMetadata {
  readonly generator: string;
  readonly name?: string;
  readonly path?: string;
  [key: string]: any;
}

/**
 * Add metadata about the generator that generated the component to the project.json
 */
export const addComponentGeneratorMetadata = (
  tree: Tree,
  projectName: string,
  info: { id: string },
  componentPath: string,
  componentName?: string,
  additionalMetadata?: { [key: string]: any },
) => {
  const config = readProjectConfigurationUnqualified(tree, projectName);

  const existingComponents = (config?.metadata as any)?.components ?? [];
  const alreadyAdded = existingComponents.filter(
    (c: any) => c.generator === info.id && c.name === componentName,
  );

  if (alreadyAdded.length === 0) {
    const componentMetadata: ComponentMetadata = {
      generator: info.id,
      path: componentPath,
      ...(componentName ? { name: componentName } : {}),
      ...additionalMetadata,
    };
    // Place metadata before targets for a stable serialized key order.
    const { targets, ...rest } = config;
    updateProjectConfiguration(tree, config.name, {
      ...rest,
      metadata: {
        ...config?.metadata,
        components: [...existingComponents, componentMetadata],
      } as any,
      ...(targets ? { targets } : {}),
    });
  }
};

/**
 * A single entry in an Nx `dependsOn` array.
 * Matches the shape accepted by Nx without requiring a devkit type import.
 */
export type TargetDependency =
  | string
  | {
      projects?: string | string[];
      target: string;
      params?: 'ignore' | 'forward';
    };

const targetDependencyEquals = (a: TargetDependency, b: TargetDependency) => {
  if (typeof a === 'string' || typeof b === 'string') {
    return a === b;
  }
  if (a.target !== b.target || a.params !== b.params) {
    return false;
  }
  const aProjects = Array.isArray(a.projects)
    ? a.projects
    : a.projects !== undefined
      ? [a.projects]
      : [];
  const bProjects = Array.isArray(b.projects)
    ? b.projects
    : b.projects !== undefined
      ? [b.projects]
      : [];
  if (aProjects.length !== bProjects.length) {
    return false;
  }
  return aProjects.every((p, i) => p === bProjects[i]);
};

// Order in which Nx serialises target properties when it reads then rewrites an
// existing project.json. Authoring targets in this order keeps a generator's
// first-run output byte-identical to subsequent runs (idempotency).
const NX_TARGET_KEY_ORDER = [
  'executor',
  'dependsOn',
  'continuous',
  'outputs',
  'cache',
  'inputs',
  'metadata',
  'defaultConfiguration',
  'options',
  'configurations',
];

/**
 * Reorder a target's keys to match Nx's own serialization order. Nx reorders
 * target properties when it rewrites an existing project.json, so applying the
 * same order when first authoring a target keeps generators idempotent.
 */
export const normalizeTargetKeyOrder = <T extends object>(target: T): T =>
  Object.fromEntries(
    Object.entries(target as Record<string, unknown>).sort(([a], [b]) => {
      const ai = NX_TARGET_KEY_ORDER.indexOf(a);
      const bi = NX_TARGET_KEY_ORDER.indexOf(b);
      return (
        (ai === -1 ? NX_TARGET_KEY_ORDER.length : ai) -
        (bi === -1 ? NX_TARGET_KEY_ORDER.length : bi)
      );
    }),
  ) as T;

/**
 * Mutate the project to add the dependency to the target if not already present
 * Adds the target if not present.
 *
 * Accepts either a string target name (e.g. `'build'`) or a dependency config
 * object (e.g. `{ projects: ['foo'], target: 'serve-local' }`). Deduplicates
 * using deep equality so re-running a generator does not grow `dependsOn`.
 */
export const addDependencyToTargetIfNotPresent = (
  project: ProjectConfiguration,
  target: string,
  dependency: TargetDependency,
) => {
  project.targets ??= {};
  project.targets[target] ??= {};
  project.targets[target].dependsOn ??= [];
  const dependsOn = project.targets[target].dependsOn;
  // Leave existing dependencies in place so re-running does not reorder them;
  // only append when the dependency is genuinely absent.
  if (!dependsOn.some((d) => targetDependencyEquals(d, dependency))) {
    dependsOn.push(dependency);
  }
  // Keep key order aligned with Nx's so first run matches subsequent runs.
  project.targets[target] = normalizeTargetKeyOrder(project.targets[target]);
};

/**
 * Build a `dev` alias target that simply runs the given serve-local target.
 * Used to expose a consistent `dev` (or `<prefix>-dev`) entry point alongside
 * every serve-local target across generators.
 */
export const createDevAliasTarget = (serveLocalTargetName: string) =>
  normalizeTargetKeyOrder({
    continuous: true,
    dependsOn: [serveLocalTargetName],
  });

/**
 * Add a `dev` alias for a serve-local target to a project's targets.
 *
 * - Adds `<devTargetName>` aliasing `<serveLocalTargetName>` (defaults to
 *   `dev` -> `serve-local`). For component generators that author prefixed
 *   targets, pass e.g. `${prefix}-serve-local` and `${prefix}-dev`.
 * - When `aliasAsProjectDev` is true (used by component generators), every
 *   component added to the project accumulates its `<devTargetName>` under the
 *   project-level `dev` target, so `nx run <project>:dev` starts all
 *   components. Nx keys tasks by `project:target`, so any serve-local
 *   dependencies shared between components run exactly once.
 */
export const addDevAlias = (
  targets: Record<string, ProjectConfiguration['targets'][string]>,
  serveLocalTargetName: string,
  options?: { devTargetName?: string; aliasAsProjectDev?: boolean },
) => {
  const devTargetName = options?.devTargetName ?? 'dev';
  targets[devTargetName] ??= createDevAliasTarget(serveLocalTargetName);
  if (options?.aliasAsProjectDev && devTargetName !== 'dev') {
    targets['dev'] ??= { continuous: true, dependsOn: [] };
    const projectDev = targets['dev'];
    projectDev.continuous = true;
    projectDev.dependsOn ??= [];
    // Append in component-creation order; dedupe keeps re-runs idempotent.
    if (!projectDev.dependsOn.includes(devTargetName)) {
      projectDev.dependsOn.push(devTargetName);
    }
    targets['dev'] = normalizeTargetKeyOrder(projectDev);
  }
};
