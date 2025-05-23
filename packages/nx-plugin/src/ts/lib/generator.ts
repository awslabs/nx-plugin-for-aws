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
import { TsProjectGeneratorSchema } from './schema';
import { libraryGenerator } from '@nx/js';
import { getNpmScopePrefix } from '../../utils/npm-scope';
import { configureTsProject } from './ts-project-utils';
import { toKebabCase } from '../../utils/names';
import { relative } from 'path';
import { formatFilesInSubtree } from '../../utils/format';
import { sortObjectKeys } from '../../utils/object';
import { NxGeneratorInfo, getGeneratorInfo } from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { replace } from '../../utils/ast';
import { ArrayLiteralExpression, factory } from 'typescript';

export const TS_LIB_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

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
  schema: TsProjectGeneratorSchema,
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
 * Generates a typescript project
 */
export const tsProjectGenerator = async (
  tree: Tree,
  schema: TsProjectGeneratorSchema,
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
  delete targets['lint'];
  projectConfiguration.targets = sortObjectKeys(targets);

  updateProjectConfiguration(tree, fullyQualifiedName, projectConfiguration);

  updateJson(tree, 'nx.json', (nxJson: NxJsonConfiguration) => {
    nxJson.namedInputs = {
      ...nxJson.namedInputs,
      default: [
        ...(nxJson.namedInputs?.default ?? []).filter(
          (input) =>
            typeof input !== 'object' ||
            !('dependentTasksOutputFiles' in input) ||
            !(input.dependentTasksOutputFiles === '**/*' && input.transitive),
        ),
        {
          dependentTasksOutputFiles: '**/*',
          transitive: true,
        },
      ],
    };

    nxJson.targetDefaults = {
      ...nxJson.targetDefaults,
      compile: {
        cache: true,
        ...nxJson.targetDefaults?.compile,
        inputs: [
          ...(nxJson.targetDefaults?.compile?.inputs ?? []).filter(
            (i) => i !== 'default',
          ),
          'default',
        ],
      },
      build: {
        cache: true,
        ...nxJson.targetDefaults?.build,
        inputs: [
          ...(nxJson.targetDefaults?.build?.inputs ?? []).filter(
            (i) => i !== 'default',
          ),
          'default',
        ],
      },
      test: {
        ...nxJson.targetDefaults?.test,
        inputs: [
          ...(nxJson.targetDefaults?.test?.inputs ?? []).filter(
            (i) => i !== 'default',
          ),
          'default',
        ],
      },
    };

    // Ensure we only declare a single typescript plugin with the correct settings
    nxJson.plugins = [
      {
        plugin: '@nx/js/typescript',
        options: {
          typecheck: {
            targetName: 'typecheck',
          },
          build: {
            targetName: 'compile',
            configName: 'tsconfig.lib.json',
            buildDepsName: 'build-deps',
            watchDepsName: 'watch-deps',
          },
        },
      },
      ...nxJson.plugins.filter(
        (p) => typeof p === 'string' || p.plugin !== '@nx/js/typescript',
      ),
    ];

    return nxJson;
  });

  // change error to warn for the @nx/dependency-checks rule
  replace(
    tree,
    joinPathFragments(dir, 'eslint.config.mjs'),
    'PropertyAssignment:has(Identifier[name="rules"]) ObjectLiteralExpression PropertyAssignment:has(StringLiteral[value="@nx/dependency-checks"]) ArrayLiteralExpression:has(StringLiteral[value="error"])',
    (node: ArrayLiteralExpression) => {
      return factory.createArrayLiteralExpression([
        factory.createStringLiteral('warn'),
        ...node.elements.slice(1),
      ]);
    },
  );

  await addGeneratorMetricsIfApplicable(tree, [TS_LIB_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);

  return () => {
    if (!schema.skipInstall) {
      installPackagesTask(tree);
    }
  };
};
export default tsProjectGenerator;
