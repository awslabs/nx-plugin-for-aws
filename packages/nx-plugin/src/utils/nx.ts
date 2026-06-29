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
import PackageJson from '../../package.json' with { type: 'json' };
import { toSnakeCase } from './names';
import { getNpmScope, getNpmScopePrefix } from './npm-scope';

export type { GeneratorInfo, NxGeneratorInfo } from './generators';
export { buildGeneratorInfoList } from './generators';

import { buildGeneratorInfoList, type GeneratorInfo } from './generators';

const GENERATORS = buildGeneratorInfoList(
  path.resolve(import.meta.dirname, '..', '..'),
);

/**
 * List Nx Plugin for AWS generators
 * @param includeHidden include hidden generators (default false)
 */
export const listGenerators = (includeHidden = false) =>
  GENERATORS.filter((g) => includeHidden || !g.hidden);

/**
 * Return generator information. Call this from a generator method with import.meta.filename
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

// The order target properties are authored in. Nx preserves a target's
// authored key order when it reads then rewrites an existing project.json,
// except `options` and `configurations`, which it always moves to the end (in
// that order). Keeping `options`/`configurations` last here therefore makes a
// generator's first-run output byte-identical to subsequent runs (idempotency);
// the remaining keys are ordered to read intuitively.
const NX_TARGET_KEY_ORDER = [
  'executor',
  'dependsOn',
  'continuous',
  'cache',
  'inputs',
  'outputs',
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
 * object (e.g. `{ projects: ['foo'], target: 'dev' }`). Deduplicates
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
 * Register a component's `<name>-dev` target under the project-level `dev`
 * target, so `nx run <project>:dev` starts every component in the project.
 *
 * Component generators author their own continuous `<name>-dev` runner and call
 * this to aggregate it. Every component added to the project accumulates its
 * `<name>-dev` under `dev`. Nx keys tasks by `project:target`, so any
 * dependencies shared between components run exactly once.
 */
export const addComponentDevTarget = (
  targets: Record<string, ProjectConfiguration['targets'][string]>,
  componentDevTargetName: string,
) => {
  targets['dev'] ??= { continuous: true, dependsOn: [] };
  const projectDev = targets['dev'];
  projectDev.continuous = true;
  projectDev.dependsOn ??= [];
  // Append in component-creation order; dedupe keeps re-runs idempotent.
  if (!projectDev.dependsOn.includes(componentDevTargetName)) {
    projectDev.dependsOn.push(componentDevTargetName);
  }
  targets['dev'] = normalizeTargetKeyOrder(projectDev);
};
