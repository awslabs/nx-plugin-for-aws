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
  type TargetConfiguration,
  type Tree,
  updateJson,
  updateProjectConfiguration,
} from '@nx/devkit';
import { libraryGenerator } from '@nx/js';
import { declareDependencies } from '../../utils/declared-dependencies.js';
import { formatFilesInSubtree } from '../../utils/format.js';
import { installDependencies } from '../../utils/install.js';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics.js';
import { isEsmWorkspace } from '../../utils/module-format.js';
import { toKebabCase } from '../../utils/names.js';
import { getNpmScopePrefix } from '../../utils/npm-scope.js';
import {
  addGeneratorMetadata,
  getGeneratorInfo,
  mergeTargetDefault,
  type NxGeneratorInfo,
  projectExists,
} from '../../utils/nx.js';
import { sortObjectKeys } from '../../utils/object.js';
import { getPackageManagerDisplayCommands } from '../../utils/pkg-manager.js';
import type { TsProjectGeneratorSchema } from './schema';
import {
  configureTsProject,
  TS_PROJECT_DEPENDENCIES,
} from './ts-project-utils.js';
import { VITEST_DEPENDENCIES } from './vitest.js';

export const DEPENDENCIES = declareDependencies()({
  ts: [...VITEST_DEPENDENCIES, ...TS_PROJECT_DEPENDENCIES],
});

export const TS_LIB_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

/**
 * Consumes build artifacts produced by a project's dependencies, so a task
 * re-runs when the output it actually reads changes.
 *
 * Test reports are excluded rather than build artifacts included: several
 * generators emit generated sources outside `dist` (an OpenAPI client under a
 * website's `src/generated`, a Smithy SSDK, the Prisma client) and add them to
 * `.gitignore`, which keeps them out of the project's own fileset — so this
 * input is the only thing that hashes them. `reports/` and `coverage/` hold
 * pytest's JUnit and coverage XML, which carry a wall-clock timestamp and so
 * mint a fresh hash on every test run that would cascade through the graph.
 */
export const DEPENDENT_TASKS_OUTPUT_FILES_INPUT = {
  dependentTasksOutputFiles: '!{reports,coverage}/**',
  transitive: true,
};

// Globs this generator has vended for the dependent-task-output input. Any of
// them is replaced in place, so the entry is neither duplicated nor left at a
// different scope when a generator re-runs.
const VENDED_DEPENDENT_TASKS_OUTPUT_GLOBS = [
  '**/*',
  'dist/**',
  DEPENDENT_TASKS_OUTPUT_FILES_INPUT.dependentTasksOutputFiles,
];

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
  // The module format is workspace-wide, established by the preset when the
  // workspace is created, so vending generators always infer it from the tree.
  const esm = isEsmWorkspace(tree);

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
        esm,
        pkgMgrCmd: getPackageManagerDisplayCommands().exec,
      },
      {
        overwriteStrategy: OverwriteStrategy.KeepExisting,
      },
    );
  }
  await configureTsProject(
    tree,
    {
      dir,
      fullyQualifiedName,
      esm,
    },
    DEPENDENCIES,
  );

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
  // The artifact-only sibling of build, which the deploy targets depend on.
  targets['assemble'] = {
    dependsOn: ['compile'],
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
            !(
              VENDED_DEPENDENT_TASKS_OUTPUT_GLOBS.includes(
                input.dependentTasksOutputFiles as string,
              ) && input.transitive
            ),
        ),
        DEPENDENT_TASKS_OUTPUT_FILES_INPUT,
      ],
    };

    const withDefaultInput = (base: Partial<TargetConfiguration>) => ({
      ...base,
      inputs: [
        ...(base.inputs ?? []).filter((i) => i !== 'default'),
        'default',
      ],
    });

    nxJson.targetDefaults = {
      ...nxJson.targetDefaults,
      compile: mergeTargetDefault(nxJson.targetDefaults?.compile, (base) => ({
        cache: true,
        ...withDefaultInput(base),
      })),
      build: mergeTargetDefault(nxJson.targetDefaults?.build, (base) => ({
        cache: true,
        ...withDefaultInput(base),
      })),
      test: mergeTargetDefault(nxJson.targetDefaults?.test, withDefaultInput),
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

  // `installDependencies` ensures vitest resolves for the `typescript` language (the
  // generated vitest.config.mts imports it and Nx loads that config when
  // computing the project graph), so a deferred install still runs when needed.
  return () =>
    installDependencies(tree, schema.preferInstallDependencies, {
      languages: ['typescript'],
    });
};
export default tsProjectGenerator;
