/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  generateFiles,
  installPackagesTask,
  joinPathFragments,
  readJson,
  type Tree,
  writeJson,
} from '@nx/devkit';
import camelCase from 'lodash.camelcase';
import PackageJson from '../../../package.json';
import { addStarExport, applyGritQL } from '../../utils/ast';
import { formatFilesInSubtree } from '../../utils/format';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { kebabCase, pascalCase, snakeCase } from '../../utils/names';
import {
  addComponentGeneratorMetadata,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { sortObjectKeys } from '../../utils/object';
import { getRelativePathToRootByDirectory } from '../../utils/paths';
import { configureTsProjectAsNxPlugin } from '../nx-plugin/utils';
import type { TsNxGeneratorGeneratorSchema } from './schema';

export const NX_GENERATOR_GENERATOR_INFO = getGeneratorInfo(__filename);

export const tsNxGeneratorGenerator = async (
  tree: Tree,
  options: TsNxGeneratorGeneratorSchema,
): Promise<GeneratorCallback | void> => {
  const { name, directory, project: pluginProject, description } = options;

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

  // Configure the targeted project as an Nx Plugin
  configureTsProjectAsNxPlugin(tree, pluginProject);

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
    if (pluginProject !== PackageJson.name) {
      throw new Error(
        `Generators should be added to the ${PackageJson.name} project.`,
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

    // Update the docs config to add the page entry to the Generator guides sidebar section
    await applyGritQL(
      tree,
      joinPathFragments('docs', 'astro.config.mjs'),
      `\`items: [$items]\` where { $items <: within \`sidebar: [$_]\`, $items <: contains \`'ts#project'\`, $items <: not contains \`'/guides/${enhancedOptions.nameKebabCase}'\`, $items += \`, { label: '${name}', link: '/guides/${enhancedOptions.nameKebabCase}' }\` }`,
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
      await addStarExport(tree, indexPath, `./${generatorSubDir}/generator`);
    }

    addComponentGeneratorMetadata(
      tree,
      plugin.name,
      NX_GENERATOR_GENERATOR_INFO,
      joinPathFragments(srcDir, generatorSubDir),
      name,
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
  // Reuse the existing metric for a same-name re-run, otherwise allocate a new one
  const metric =
    generatorsJson?.generators?.[name]?.metric ??
    (existingGenerators.length > 0
      ? incrementMetric(existingGenerators.map((g) => g.metric))
      : 'g1');
  writeJson(tree, generatorsJsonPath, {
    ...generatorsJson,
    generators: sortObjectKeys({
      ...generatorsJson?.generators,
      [name]: {
        factory: `${factoryBasePath}/generator`,
        schema: `${factoryBasePath}/schema.json`,
        description:
          description ?? 'TODO: Add short description of the generator',
        ...(isNxPluginForAws ? { metric } : {}),
      },
    }),
  });

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
