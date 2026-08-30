/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
  updateJson,
} from '@nx/devkit';
import {
  GENERATED_REPORTS_DIRECTORY,
  getCoverageReportsDirectory,
} from '../../../ts/lib/vitest.js';
import { applyGritQL, matchGritQL } from '../../../utils/ast.js';
import {
  BIOME_TEST_OUTPUT_EXCLUDE,
  formatFilesInSubtree,
} from '../../../utils/format.js';

/**
 * Point each project's vitest coverage directory at the workspace's `dist`.
 *
 * `@nx/vitest` writes `reportsDirectory: './test-output/vitest/coverage'`, which
 * resolves inside the project. Coverage is off by default, so the directory stays
 * dormant until someone runs `vitest --coverage` — at which point the HTML
 * reporter's bundled third-party scripts land in the project, where the `format`
 * target reformats them (failing every later build) and the `default` named input
 * counts them, so no task in the project can be cached again.
 *
 * Guardrails:
 * - The pattern is anchored to the exact literal `@nx/vitest` generated, and
 *   scoped to the `coverage` block of the config's own `test` object, so a
 *   `reportsDirectory` elsewhere in the file is left alone.
 * - A project whose directory has been repointed keeps its value, and is reported
 *   via `nextSteps` instead.
 * - Idempotent: the pattern no longer matches once rewritten.
 */

/** The config filenames a generated project may carry. */
const CONFIG_FILES = ['vitest.config.mts', 'vite.config.mts'];

/**
 * The `coverage` block of the object the config factory returns, scoped so a
 * `coverage` option elsewhere in the file is not matched.
 */
const coveragePattern = (body: string): string =>
  `\`test: { $props }\` where {
  $props <: within \`defineConfig($_)\`,
  $props <: some \`coverage: { $cov }\`,
  ${body}
}`;

/** Matches a coverage block still carrying the directory `@nx/vitest` generated. */
const GENERATED_DIRECTORY_PATTERN = coveragePattern(
  `$cov <: some \`reportsDirectory: '${GENERATED_REPORTS_DIRECTORY}'\``,
);

/** Matches a coverage block that declares a `reportsDirectory` at all. */
const ANY_DIRECTORY_PATTERN = coveragePattern(
  '$cov <: some `reportsDirectory: $_`',
);

/** Rewrites the generated directory to the one under `dist` for a project root. */
const rewriteDirectoryPattern = (projectRoot: string): string =>
  coveragePattern(
    `$cov <: some \`reportsDirectory: '${GENERATED_REPORTS_DIRECTORY}'\` as $reportsDirectory,
  $reportsDirectory => \`reportsDirectory: '${getCoverageReportsDirectory(projectRoot)}'\``,
  );

/** Matches a coverage block already pointing at the directory under `dist`. */
const migratedDirectoryPattern = (projectRoot: string): string =>
  coveragePattern(
    `$cov <: some \`reportsDirectory: '${getCoverageReportsDirectory(projectRoot)}'\``,
  );

/**
 * Exclude test reports from Biome, so a coverage directory pointed anywhere
 * inside the workspace is still never formatted or linted. Only added alongside
 * the excludes we vend, so a workspace that has rewritten `files.includes`
 * wholesale keeps its own list.
 */
const excludeTestOutputFromBiome = (tree: Tree): void => {
  if (!tree.exists('biome.json')) {
    return;
  }
  updateJson(tree, 'biome.json', (biome) => {
    const includes: unknown = biome?.files?.includes;
    if (
      !Array.isArray(includes) ||
      includes.includes(BIOME_TEST_OUTPUT_EXCLUDE) ||
      !includes.includes('!**/out-tsc')
    ) {
      return biome;
    }
    return {
      ...biome,
      files: {
        ...biome.files,
        includes: includes.flatMap((include) =>
          include === '!**/out-tsc'
            ? [include, BIOME_TEST_OUTPUT_EXCLUDE]
            : [include],
        ),
      },
    };
  });
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  excludeTestOutputFromBiome(tree);

  for (const [name, project] of getProjects(tree)) {
    for (const configFile of CONFIG_FILES) {
      const configPath = joinPathFragments(project.root, configFile);
      if (!tree.exists(configPath)) {
        continue;
      }

      if (await matchGritQL(tree, configPath, GENERATED_DIRECTORY_PATTERN)) {
        await applyGritQL(
          tree,
          configPath,
          rewriteDirectoryPattern(project.root),
        );
        continue;
      }

      // A directory the user repointed is theirs to keep, but it may still sit
      // inside the project, so report it rather than rewriting it. A config
      // declaring no directory at all relies on vitest's default, which this
      // migration has no generated shape to match.
      if (
        (await matchGritQL(tree, configPath, ANY_DIRECTORY_PATTERN)) &&
        !(await matchGritQL(
          tree,
          configPath,
          migratedDirectoryPattern(project.root),
        ))
      ) {
        nextSteps.push(
          `${name}: \`${configPath}\` sets its own \`test.coverage.reportsDirectory\`. Point it outside the project (eg \`${getCoverageReportsDirectory(project.root)}\`) so coverage output is not formatted, linted or treated as a task input.`,
        );
      }
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
