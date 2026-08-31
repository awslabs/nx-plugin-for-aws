/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type ProjectConfiguration,
  type Tree,
  updateJson,
} from '@nx/devkit';
import { isAbsolute } from 'path';
import {
  GENERATED_REPORTS_DIRECTORY,
  getCoverageReportsDirectory,
} from '../../../ts/lib/vitest.js';
import { applyGritQL, matchGritQL } from '../../../utils/ast.js';
import {
  BIOME_TEST_OUTPUT_EXCLUDE,
  formatFilesInSubtree,
} from '../../../utils/format.js';
import { updateGitIgnore } from '../../../utils/git.js';

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
 * Alongside the rewrite, the coverage directory an older release already wrote
 * into the project is deleted and `test-output` is added to the workspace
 * `.gitignore`, so the reporter's vendored third-party scripts can neither be
 * committed nor picked up by `license#sync`.
 *
 * Guardrails:
 * - The pattern is anchored to the exact literal `@nx/vitest` generated, and
 *   scoped to the `coverage` block of the config's own `test` object, so a
 *   `reportsDirectory` elsewhere in the file is left alone.
 * - A project whose directory has been repointed keeps its value, and is reported
 *   via `nextSteps` instead — as is one whose directory is set on a target, or a
 *   `biome.json` whose `files.includes` has diverged from the vended list.
 * - Idempotent: the pattern no longer matches once rewritten.
 */

/**
 * The config filenames to check. Generated projects carry the `.mts` forms; the
 * other extensions vitest supports are included so a project whose config was
 * renamed is still migrated. Safe to widen, because the pattern matched inside is
 * anchored to the exact literal `@nx/vitest` generated.
 */
const CONFIG_FILES = [
  'vitest.config.mts',
  'vitest.config.ts',
  'vitest.config.mjs',
  'vitest.config.js',
  'vite.config.mts',
  'vite.config.ts',
  'vite.config.mjs',
  'vite.config.js',
];

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

/** The directory an older release wrote coverage into, relative to a project. */
const OLD_COVERAGE_DIRECTORY = 'test-output';

/**
 * Exclude test reports from Biome, so a coverage directory pointed anywhere
 * inside the workspace is still never formatted or linted. Anchored to the
 * excludes we vend, so a workspace that has rewritten `files.includes` keeps its
 * own list — and is told to add the exclude itself.
 */
const excludeTestOutputFromBiome = (tree: Tree): string[] => {
  if (!tree.exists('biome.json')) {
    return [];
  }
  let unrecognised = false;
  updateJson(tree, 'biome.json', (biome) => {
    const includes: unknown = biome?.files?.includes;
    if (
      !Array.isArray(includes) ||
      includes.includes(BIOME_TEST_OUTPUT_EXCLUDE)
    ) {
      return biome;
    }
    // Placed next to the other build-output excludes. Without that anchor the
    // list has diverged from the one we vend, so leave it to the user.
    if (!includes.includes('!**/out-tsc')) {
      unrecognised = true;
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
  return unrecognised
    ? [
        `\`biome.json\`: add \`"${BIOME_TEST_OUTPUT_EXCLUDE}"\` to \`files.includes\` so test reports are never formatted or linted. Its \`files.includes\` has diverged from the vended list, so it was left as it is.`,
      ]
    : [];
};

/**
 * Delete the coverage directory an older release wrote inside the project.
 *
 * Left in place it stays git-visible: the vended `.gitignore` covers `dist` but
 * not `test-output`, so the HTML reporter's vendored third-party scripts can be
 * committed, and `license#sync` — which builds its candidate set from
 * git-visible files rather than from `biome.json` — would stamp an Apache-2.0
 * header onto them. Only the reporter's own output is removed; anything else the
 * user keeps there is left alone.
 */
const deleteOldCoverageDirectory = (tree: Tree, projectRoot: string): void => {
  const oldDirectory = joinPathFragments(
    projectRoot,
    OLD_COVERAGE_DIRECTORY,
    'vitest/coverage',
  );
  if (tree.exists(oldDirectory)) {
    tree.delete(oldDirectory);
  }
};

/**
 * A `reportsDirectory` set on a target rather than in the vitest config, which
 * takes precedence over the config value. `@nx/vitest` supports this shape, so
 * report any that still resolves inside the project — rewriting a target option
 * is the user's call, not this migration's.
 */
const targetReportsDirectories = (
  project: ProjectConfiguration,
): { target: string; reportsDirectory: string }[] => {
  const found: { target: string; reportsDirectory: string }[] = [];
  for (const [target, config] of Object.entries(project.targets ?? {})) {
    for (const options of [
      config.options,
      ...Object.values(config.configurations ?? {}),
    ]) {
      const reportsDirectory: unknown = options?.reportsDirectory;
      // A path escaping the project root is already outside it.
      if (
        typeof reportsDirectory === 'string' &&
        !reportsDirectory.startsWith('..') &&
        !isAbsolute(reportsDirectory)
      ) {
        found.push({ target, reportsDirectory });
      }
    }
  }
  return found;
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [...excludeTestOutputFromBiome(tree)];

  // Test reports are build output, so ignore them wherever a project writes them.
  updateGitIgnore(tree, '.', (patterns) =>
    patterns.includes(OLD_COVERAGE_DIRECTORY)
      ? patterns
      : [...patterns, OLD_COVERAGE_DIRECTORY],
  );

  for (const [name, project] of getProjects(tree)) {
    for (const { target, reportsDirectory } of targetReportsDirectories(
      project,
    )) {
      nextSteps.push(
        `${name}: the \`${target}\` target sets \`reportsDirectory: '${reportsDirectory}'\`, which resolves inside the project and takes precedence over the vitest config. Point it outside the project (eg \`${getCoverageReportsDirectory(project.root)}\`).`,
      );
    }

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
        deleteOldCoverageDirectory(tree, project.root);
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
