/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  GeneratorCallback,
  NxJsonConfiguration,
  OverwriteStrategy,
  Tree,
  generateFiles,
  getPackageManagerCommand,
  installPackagesTask,
  joinPathFragments,
  readProjectConfiguration,
  updateJson,
  updateProjectConfiguration,
} from '@nx/devkit';
import { TsLibGeneratorSchema } from './schema';
import { libraryGenerator } from '@nx/js';
import { getNpmScopePrefix } from '../../utils/npm-scope';
import { configureTsProject } from './ts-project-utils';
import { toKebabCase } from '../../utils/names';
import { relative } from 'path';
import { formatFilesInSubtree } from '../../utils/format';
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
  schema: TsLibGeneratorSchema,
): TsLibDetails => {
  const scope = getNpmScopePrefix(tree);
  const normalizedName = toKebabCase(schema.name);
  const fullyQualifiedName = `${scope}${normalizedName}`;
  const dir = joinPathFragments(
    toKebabCase(schema.directory) ?? '.',
    toKebabCase(schema.subDirectory) ?? normalizedName,
  );
  return { dir, fullyQualifiedName };
};
/**
 * Generates a typescript library
 */
export const tsLibGenerator = async (
  tree: Tree,
  schema: TsLibGeneratorSchema,
): Promise<GeneratorCallback> => {
  const { fullyQualifiedName, dir } = getTsLibDetails(tree, schema);
  await libraryGenerator(tree, {
    ...schema,
    name: toKebabCase(schema.name),
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
    },
  );
  configureTsProject(tree, {
    dir,
    fullyQualifiedName,
  });

  const projectConfiguration = readProjectConfiguration(
    tree,
    fullyQualifiedName,
  );
  const targets = projectConfiguration.targets;

  targets['compile'] = {
    executor: 'nx:run-commands',
    outputs: [`{workspaceRoot}/dist/${dir}/tsc`],
    options: {
      command: 'tsc --build tsconfig.lib.json',
      cwd: '{projectRoot}',
    },
  };
  targets['build'] = {
    dependsOn: ['lint', 'compile', 'test'],
  };
  targets['test'] = {
    executor: '@nx/vite:test',
    outputs: ['{options.reportsDirectory}'],
    options: {
      reportsDirectory: joinPathFragments(
        relative(joinPathFragments(tree.root, dir), tree.root),
        'coverage',
        dir,
      ),
    },
  };
  projectConfiguration.targets = Object.keys(targets)
    .sort()
    .reduce((obj, key) => {
      obj[key] = targets[key];
      return obj;
    }, {});

  updateProjectConfiguration(tree, fullyQualifiedName, projectConfiguration);

  updateJson(tree, 'nx.json', (nxJson: NxJsonConfiguration) => {
    nxJson.plugins = nxJson.plugins.map((p) => {
      if (typeof p !== 'string' && p.plugin === '@nx/js/typescript' && p.options?.['build']) {
         p.options['build'].targetName = 'compile';
      }
      return p;
    });
    return nxJson;
  });

  formatFilesInSubtree(tree);

  return () => {
    if (!schema.skipInstall) {
      installPackagesTask(tree);
    }
  };
};
export default tsLibGenerator;
