/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  type NxJsonConfiguration,
  OverwriteStrategy,
  readProjectConfiguration,
  type Tree,
  updateJson,
  updateProjectConfiguration,
} from '@nx/devkit';
import { libraryGenerator } from '@nx/js';
import { formatFilesInSubtree } from '../../utils/format';
import { installDeps } from '../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { toKebabCase } from '../../utils/names';
import { getNpmScopePrefix } from '../../utils/npm-scope';
import {
  addGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  projectExists,
} from '../../utils/nx';
import { sortObjectKeys } from '../../utils/object';
import { getPackageManagerDisplayCommands } from '../../utils/pkg-manager';
import type { TsProjectGeneratorSchema } from './schema';
import { configureTsProject } from './ts-project-utils';

export const TS_LIB_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

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
  // NB: interactive nx generator cli can pass empty string
  const dir = joinPathFragments(
    schema.directory || '.',
    schema.subDirectory || normalizedName,
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

  // Only scaffold the project on first run; on re-run skip creation so user
  // edits are preserved, but continue to (re)apply the configuration below.
  if (!projectExists(tree, fullyQualifiedName)) {
    await libraryGenerator(tree, {
      ...schema,
      name: fullyQualifiedName,
      directory: dir,
      skipPackageJson: true,
      bundler: 'tsc', // TODO: consider supporting others
      linter: 'none',
      unitTestRunner: 'vitest',
      // Register the @nx/vitest plugin so the test target is inferred rather
      // than emitting the deprecated @nx/vitest:test executor target.
      addPlugin: true,
    });

    // Replace with simpler sample source code
    tree.delete(joinPathFragments(dir, 'src'));
    generateFiles(
      tree,
      joinPathFragments(import.meta.dirname, 'files'),
      joinPathFragments(dir),
      {
        fullyQualifiedName,
        pkgMgrCmd: getPackageManagerDisplayCommands().exec,
      },
      {
        overwriteStrategy: OverwriteStrategy.KeepExisting,
      },
    );
  }
  await configureTsProject(tree, {
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
    outputs: ['{workspaceRoot}/dist/{projectRoot}/tsc'],
    options: {
      command: 'tsc --build tsconfig.lib.json',
      cwd: '{projectRoot}',
    },
  };
  targets['build'] = {
    dependsOn: ['lint', 'compile', 'test'],
  };
  projectConfiguration.targets = sortObjectKeys(targets);

  updateProjectConfiguration(tree, fullyQualifiedName, projectConfiguration);

  addGeneratorMetadata(tree, fullyQualifiedName, TS_LIB_GENERATOR_INFO);

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
      ...(nxJson.plugins ?? []).filter(
        (p) => typeof p === 'string' || p.plugin !== '@nx/js/typescript',
      ),
    ];

    return nxJson;
  });

  await addGeneratorMetricsIfApplicable(tree, [TS_LIB_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);

  // `installDeps` ensures vitest resolves for the `typescript` language (the
  // generated vitest.config.mts imports it and Nx loads that config when
  // computing the project graph), so a deferred install still runs when needed.
  return () => installDeps(tree, schema.preferInstallDependencies, {
    languages: ['typescript'],
  });
};
export default tsProjectGenerator;
