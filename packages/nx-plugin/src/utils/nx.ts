/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getProjects, readProjectConfiguration, Tree } from '@nx/devkit';
import GeneratorsJson from '../../generators.json';
import PackageJson from '../../package.json';
import * as path from 'path';
import { getNpmScope, getNpmScopePrefix } from './npm-scope';
import { toSnakeCase } from './names';

export interface NxGeneratorInfo {
  readonly id: string;
  readonly metric: string;
  readonly resolvedFactoryPath: string;
  readonly resolvedSchemaPath: string;
  readonly hidden?: boolean;
  readonly description: string;
  readonly guidePages?: string[];
}

const GENERATORS: NxGeneratorInfo[] = Object.entries(
  GeneratorsJson.generators,
).map(([id, info]) => ({
  id,
  metric: info.metric,
  resolvedFactoryPath: path.resolve(__dirname, '..', '..', info.factory),
  resolvedSchemaPath: path.resolve(__dirname, '..', '..', info.schema),
  description: info.description,
  ...('hidden' in info && info.hidden
    ? {
        hidden: info.hidden,
      }
    : {}),
  ...('guidePages' in info && info.guidePages
    ? {
        guidePages: info.guidePages,
      }
    : {}),
}));

/**
 * List Nx Plugin for AWS generators
 * @param includeHidden include hidden generators (default false)
 */
export const listGenerators = (includeHidden = false): NxGeneratorInfo[] =>
  GENERATORS.filter((g) => includeHidden || !g.hidden);

/**
 * Return generator information. Call this from a generator method with __filename
 */
export const getGeneratorInfo = (
  generatorFileName: string,
): NxGeneratorInfo => {
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
