/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  generateFiles,
  GeneratorCallback,
  installPackagesTask,
  joinPathFragments,
  readJson,
  Tree,
  updateJson,
  writeJson,
} from '@nx/devkit';
import { TsNxGeneratorGeneratorSchema } from './schema';
import kebabCase from 'lodash.kebabcase';
import { pascalCase } from '../../utils/names';
import camelCase from 'lodash.camelcase';
import { getRelativePathToRootByDirectory } from '../../utils/paths';
import snakeCase from 'lodash.snakecase';
import { addStarExport, replace } from '../../utils/ast';
import { ArrayLiteralExpression, factory } from 'typescript';
import NxPluginForAwsPackageJson from '../../../package.json';
import {
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { withVersions } from '../../utils/versions';
import { formatFilesInSubtree } from '../../utils/format';
import PackageJson from '../../../package.json';

export const NX_GENERATOR_GENERATOR_INFO = getGeneratorInfo(__filename);

export const tsNxGeneratorGenerator = async (
  tree: Tree,
  options: TsNxGeneratorGeneratorSchema,
): Promise<GeneratorCallback | void> => {
  const { name, directory, pluginProject, description } = options;

  const plugin = readProjectConfigurationUnqualified(tree, pluginProject);
  const sourceRoot = plugin.sourceRoot ?? joinPathFragments(plugin.root, 'src');
  const sourceRootParts = sourceRoot.split('/');
  const srcDir = sourceRootParts[sourceRootParts.length - 1];
  const generatorSubDir = directory ?? kebabCase(name);
  const generatorDir = joinPathFragments(sourceRoot, generatorSubDir);

  const rootPackageJson = tree.exists('package.json')
    ? readJson(tree, 'package.json')
    : undefined;
  const isNxPluginForAws = rootPackageJson?.name === '@aws/nx-plugin-source';

  const tsConfigPath = joinPathFragments(plugin.root, 'tsconfig.json');
  if (!tree.exists(tsConfigPath)) {
    throw new Error(
      `Selected plugin project ${pluginProject} is not a TypeScript project`,
    );
  }

  // Generators must use commonjs as a limitation of nx
  // https://github.com/nrwl/nx/issues/15682
  updateJson(tree, tsConfigPath, (tsConfig) => {
    tsConfig.compilerOptions ??= {};
    tsConfig.compilerOptions.module ??= 'commonjs';
    return tsConfig;
  });

  const enhancedOptions = {
    name,
    description,
    namePascalCase: pascalCase(name),
    nameCamelCase: camelCase(name),
    nameKebabCase: kebabCase(name),
    nameUpperSnakeCase: snakeCase(name).toUpperCase(),
    isNxPluginForAws,
    pathToProjectSourceRoot: getRelativePathToRootByDirectory(generatorSubDir),
    generatorDir,
    generatorSubDir,
  };

  // Add the common files
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'common'),
    generatorDir,
    {
      ...enhancedOptions,
    },
  );

  // Add the files specific to this repo vs a local generator in another project
  if (isNxPluginForAws) {
    // Generators should be in the @aws/nx-plugin project
    if (pluginProject !== NxPluginForAwsPackageJson.name) {
      throw new Error(
        `Generators should be added to the ${NxPluginForAwsPackageJson.name} project.`,
      );
    }

    // Add the generator
    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files', 'nx-plugin-for-aws', 'generator'),
      generatorDir,
      {
        ...enhancedOptions,
      },
    );

    // Generate guide page in docs
    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files', 'nx-plugin-for-aws', 'docs'),
      joinPathFragments('docs', 'src', 'content', 'docs', 'en', 'guides'),
      {
        ...enhancedOptions,
      },
    );

    // Update the docs config to add the page entry
    replace(
      tree,
      joinPathFragments('docs', 'astro.config.mjs'),
      'PropertyAssignment:has(Identifier[name="integrations"]) PropertyAssignment:has(Identifier[name="sidebar"]) ObjectLiteralExpression:has(PropertyAssignment:has(StringLiteral[value="Guides"])) PropertyAssignment:has(Identifier[name="items"]) > ArrayLiteralExpression',
      (node: ArrayLiteralExpression) => {
        return factory.createArrayLiteralExpression([
          ...node.elements,
          factory.createObjectLiteralExpression([
            factory.createPropertyAssignment(
              'label',
              factory.createStringLiteral(name, true),
            ),
            factory.createPropertyAssignment(
              'link',
              factory.createStringLiteral(
                `/guides/${enhancedOptions.nameKebabCase}`,
                true,
              ),
            ),
          ]),
        ]);
      },
    );
  } else {
    // Local generator in a project other than nx-plugin-for-aws
    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files', 'local'),
      generatorDir,
      {
        ...enhancedOptions,
      },
    );

    const indexPath = joinPathFragments(sourceRoot, 'index.ts');
    if (tree.exists(indexPath)) {
      addStarExport(tree, indexPath, `./${generatorSubDir}/generator`);
    }

    // Add a dependency on the nx plugin for aws
    addDependenciesToPackageJson(
      tree,
      {},
      {
        [PackageJson.name]: `^${PackageJson.version}`,
      },
    );
  }

  const factoryBasePath = `./${srcDir}/${generatorSubDir}`;

  // Update generators.json
  const generatorsJsonPath = joinPathFragments(plugin.root, 'generators.json');
  const generatorsJson = tree.exists(generatorsJsonPath)
    ? readJson(tree, generatorsJsonPath)
    : { generators: {} };
  const existingGenerators = Object.values(
    generatorsJson?.generators ?? {},
  ) as any[];
  writeJson(tree, generatorsJsonPath, {
    ...generatorsJson,
    generators: {
      ...generatorsJson?.generators,
      [name]: {
        factory: `${factoryBasePath}/generator`,
        schema: `${factoryBasePath}/schema.json`,
        description:
          description ?? 'TODO: Add short description of the generator',
        ...(isNxPluginForAws
          ? {
              metric:
                existingGenerators.length > 0
                  ? incrementMetric(
                      Object.values(existingGenerators).map((g) => g.metric),
                    )
                  : 'g1',
            }
          : {}),
      },
    },
  });

  // Add the "generators" and "main" entries to package.json
  const pluginPackageJsonPath = joinPathFragments(plugin.root, 'package.json');
  if (!tree.exists(pluginPackageJsonPath)) {
    // Write a simple package.json to ensure the generator can be found by the Nx VSCode extension
    writeJson(tree, pluginPackageJsonPath, {
      name: plugin.name,
    });
  }
  updateJson(tree, pluginPackageJsonPath, (pkg) => {
    pkg.main ??= './src/index.js';
    pkg.generators ??= './generators.json';
    return pkg;
  });

  if (!isNxPluginForAws) {
    // Add the required dependencies to the root package.json, and project's package.json
    const deps = withVersions(['@nx/devkit']);
    addDependenciesToPackageJson(tree, {}, deps);
    addDependenciesToPackageJson(tree, deps, {}, pluginPackageJsonPath);
  }

  await addGeneratorMetricsIfApplicable(tree, [NX_GENERATOR_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);

  return () => {
    installPackagesTask(tree);
  };
};

const incrementMetric = (metrics: string[]): string => {
  const maxMetric = Math.max(...metrics.map((m) => Number(m.slice(1))));
  return `g${maxMetric + 1}`;
};

export default tsNxGeneratorGenerator;
