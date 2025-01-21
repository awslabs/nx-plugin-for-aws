/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  GeneratorCallback,
  OverwriteStrategy,
  Tree,
  generateFiles,
  getPackageManagerCommand,
  installPackagesTask,
  joinPathFragments,
} from '@nx/devkit';
import { TsLibGeneratorSchema } from './schema';
import { libraryGenerator } from '@nx/js';
import { getNpmScopePrefix } from '../../utils/npm-scope';
import { configureTsProject } from './ts-project-utils';
import { toKebabCase } from '../../utils/names';
export interface TsLibDetails {
  /**
   * Full package name including scope (eg @foo/bar)
   */
  readonly fullyQualifiedName: string;
  /**
   * Directory of the library relative to the root
   */
  readonly dir: string;
}
/**
 * Returns details about the TS library to be created
 */
export const getTsLibDetails = (
  tree: Tree,
  schema: TsLibGeneratorSchema
): TsLibDetails => {
  const scope = schema.scope ? `${schema.scope}/` : getNpmScopePrefix(tree);
  const normalizedName = toKebabCase(schema.name);
  const fullyQualifiedName = `${scope}${normalizedName}`;
  const dir = joinPathFragments(
    toKebabCase(schema.directory) ?? '.',
    toKebabCase(schema.subDirectory) ?? normalizedName
  );
  return { dir, fullyQualifiedName };
};
/**
 * Generates a typescript library
 */
export const tsLibGenerator = async (
  tree: Tree,
  schema: TsLibGeneratorSchema
): Promise<GeneratorCallback> => {
  const { fullyQualifiedName, dir } = getTsLibDetails(tree, schema);
  await libraryGenerator(tree, {
    ...schema,
    name: fullyQualifiedName,
    directory: dir,
    skipPackageJson: true,
    bundler: 'tsc', // TODO: consider supporting others
    linter: 'eslint',
    unitTestRunner: 'vitest',
  });
  // Replace with simpler sample source code
  tree.delete(joinPathFragments(dir, 'src'));
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files'),
    joinPathFragments(dir),
    {
      fullyQualifiedName,
      pkgMgrCmd: getPackageManagerCommand().exec,
    },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    }
  );
  configureTsProject(tree, {
    dir,
    fullyQualifiedName,
  });
  return () => {
    if (!schema.skipInstall) {
      installPackagesTask(tree);
    }
  };
};
export default tsLibGenerator;
