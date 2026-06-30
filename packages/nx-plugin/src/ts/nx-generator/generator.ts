/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  readJson,
  type Tree,
  writeJson,
} from '@nx/devkit';
import camelCase from 'lodash.camelcase';
import PackageJson from '../../../package.json' with { type: 'json' };
import { addStarExport, applyGritQL } from '../../utils/ast';
import { formatFilesInSubtree } from '../../utils/format';
import { installDeps } from '../../utils/install';
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

export const NX_GENERATOR_GENERATOR_INFO = getGeneratorInfo(
  import.meta.filename,
);

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

  // Add the common files, preserving any the user has already implemented
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'common'),
    generatorDir,
    {
      ...enhancedOptions,
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
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
      joinPathFragments(
        import.meta.dirname,
        'files',
        'nx-plugin-for-aws',
        'generator',
      ),
      generatorDir,
      {
        ...enhancedOptions,
      },
      { overwriteStrategy: OverwriteStrategy.KeepExisting },
    );

    // Generate guide page in docs
    generateFiles(
      tree,
      joinPathFragments(
        import.meta.dirname,
        'files',
        'nx-plugin-for-aws',
        'docs',
      ),
      joinPathFragments('docs', 'src', 'content', 'docs', 'en', 'guides'),
      {
        ...enhancedOptions,
      },
      { overwriteStrategy: OverwriteStrategy.KeepExisting },
    );

    // Update the docs config to add the page entry to the Generator guides sidebar section
    await applyGritQL(
      tree,
      joinPathFragments('docs', 'astro.config.mjs'),
      `\`items: [$items]\` where { $items <: within \`sidebar: [$_]\`, $items <: contains \`'ts#project'\`, $items <: not contains \`'/guides/${enhancedOptions.nameKebabCase}'\`, $items += \`, { label: '${name}', link: '/guides/${enhancedOptions.nameKebabCase}' }\` }`,
    );

    // Expose the generator from the SDK for known prefixes (ts# / py#)
    addSdkExport(tree, plugin.root, name, generatorSubDir, enhancedOptions);
  } else {
    // Local generator in a project other than nx-plugin-for-aws
    generateFiles(
      tree,
      joinPathFragments(import.meta.dirname, 'files', 'local'),
      generatorDir,
      {
        ...enhancedOptions,
      },
      { overwriteStrategy: OverwriteStrategy.KeepExisting },
    );

    const indexPath = joinPathFragments(sourceRoot, 'index.ts');
    if (tree.exists(indexPath)) {
      // NodeNext requires explicit extensions; the local plugin is ESM.
      await addStarExport(tree, indexPath, `./${generatorSubDir}/generator.js`);
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
  // Metrics are only tracked within the @aws/nx-plugin repo. Reuse the existing
  // metric for a same-name re-run, otherwise allocate a new one.
  let metric: string | undefined;
  if (isNxPluginForAws) {
    const existingMetrics = Object.values(generatorsJson?.generators ?? {})
      .map((g: any) => g.metric)
      .filter((m): m is string => typeof m === 'string');
    metric =
      generatorsJson?.generators?.[name]?.metric ??
      (existingMetrics.length > 0 ? incrementMetric(existingMetrics) : 'g1');
  }
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

  return () => installDeps(tree, options.preferInstallDependencies, {
    languages: ['typescript'],
  });
};

const incrementMetric = (metrics: string[]): string => {
  const maxMetric = Math.max(...metrics.map((m) => Number(m.slice(1))));
  return `g${maxMetric + 1}`;
};

// Maps a generator name prefix to the SDK entry point that should re-export it
const SDK_EXPORT_PREFIXES: Record<string, string> = {
  'ts#': 'ts',
  'py#': 'py',
};

// Re-exports a generated generator from the matching SDK entry point so it is
// available programmatically as part of @aws/nx-plugin's SDK
const addSdkExport = (
  tree: Tree,
  pluginRoot: string,
  name: string,
  generatorSubDir: string,
  options: { nameCamelCase: string; namePascalCase: string },
): void => {
  const prefix = Object.keys(SDK_EXPORT_PREFIXES).find((p) =>
    name.startsWith(p),
  );
  if (!prefix) {
    return;
  }

  const sdkPath = joinPathFragments(
    pluginRoot,
    'src',
    'sdk',
    `${SDK_EXPORT_PREFIXES[prefix]}.ts`,
  );
  const generatorExport = `${options.nameCamelCase}Generator`;
  const schemaExport = `${options.namePascalCase}GeneratorSchema`;
  const moduleBase = `../${generatorSubDir}`;

  const contents = tree.exists(sdkPath) ? tree.read(sdkPath).toString() : '';
  // Idempotent: skip if this generator is already exported
  if (contents.includes(`${moduleBase}/generator`)) {
    return;
  }

  const block = `// ${options.namePascalCase} Generator\nexport { ${generatorExport} } from '${moduleBase}/generator';\nexport type { ${schemaExport} } from '${moduleBase}/schema';\n`;

  const prefixContents = contents.trim()
    ? `${contents.replace(/\s*$/, '')}\n\n`
    : '';
  tree.write(sdkPath, `${prefixContents}${block}`);
};

export default tsNxGeneratorGenerator;
