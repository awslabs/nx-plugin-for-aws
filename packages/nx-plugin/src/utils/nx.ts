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
 * Add metadata about the generator that generated the project to the project.json
 */
export const addGeneratorMetadata = (
  tree: Tree,
  projectName: string,
  info: { id: string },
  additionalMetadata?: { [key: string]: any },
) => {
  const config = readProjectConfigurationUnqualified(tree, projectName);
  updateProjectConfiguration(tree, config.name, {
    ...config,
    metadata: {
      ...config?.metadata,
      generator: info.id,
      ...additionalMetadata,
    } as any,
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
/**
 * Return the port previously recorded for a component (matched by generator id
 * and name) so it can be reused on a re-run, or undefined if not present.
 */
export const getExistingComponentPort = (
  tree: Tree,
  projectName: string,
  info: { id: string },
  componentName?: string,
): number | undefined => {
  const config = readProjectConfigurationUnqualified(tree, projectName);
  const existingComponents = (config?.metadata as any)?.components ?? [];
  const match = existingComponents.find(
    (c: any) => c.generator === info.id && c.name === componentName,
  );
  return typeof match?.port === 'number' ? match.port : undefined;
};

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
    updateProjectConfiguration(tree, config.name, {
      ...config,
      metadata: {
        ...config?.metadata,
        components: [...existingComponents, componentMetadata],
      } as any,
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
  project.targets[target].dependsOn = [
    ...(project.targets[target].dependsOn ?? []).filter(
      (d) => !targetDependencyEquals(d, dependency),
    ),
    dependency,
  ];
};
