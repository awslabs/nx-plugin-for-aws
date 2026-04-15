/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  ProjectConfiguration,
  readProjectConfiguration,
  Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import PackageJson from '../../package.json';
import * as path from 'path';
import { getNpmScope, getNpmScopePrefix } from './npm-scope';
import { toSnakeCase } from './names';

export type { NxGeneratorInfo, GeneratorInfo } from './generators';
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
 * Mutate the project to add the dependency to the target if not already present
 * Adds the target if not present.
 */
export const addDependencyToTargetIfNotPresent = (
  project: ProjectConfiguration,
  target: string,
  dependency: string,
) => {
  project.targets ??= {};
  project.targets[target] ??= {};
  project.targets[target].dependsOn = [
    ...(project.targets[target].dependsOn ?? []).filter(
      (d) => d !== dependency,
    ),
    dependency,
  ];
};
