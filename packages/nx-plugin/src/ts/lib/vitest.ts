/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  readNxJson,
  type Tree,
  updateNxJson,
} from '@nx/devkit';
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { applyGritQL } from '../../utils/ast.js';
import {
  type DependencyDeclaration,
  forDependencies,
  type MustDeclare,
} from '../../utils/declared-dependencies.js';
import { addDependenciesToPackageJson } from '../../utils/dependencies.js';
import { type ITsDepVersion, withVersions } from '../../utils/versions.js';
import type { ConfigureProjectOptions } from './types.js';

const readGritPattern = (name: string): string =>
  readFileSync(
    join(import.meta.dirname, 'grit', `${name}.grit`),
    'utf-8',
  ).trim();

/**
 * Resolve the config's `root` from `import.meta.dirname`.
 *
 * `@nx/js` writes `root: __dirname`, which Vite's native config loader does not
 * provide — it warns today and will reject once `configLoader: 'native'` becomes
 * the default. Scoped with `some` to a direct property of the object the config
 * factory returns, so a nested `root` (a `test.alias` entry, say) is untouched.
 */
const ROOT_IMPORT_META_DIRNAME = `\`defineConfig(() => ({ $props }))\` where {
  $props <: some \`root: __dirname\` as $root,
  $root => \`root: import.meta.dirname\`
}`;

/** The `reportsDirectory` `@nx/vitest` writes, resolved against the project root. */
export const GENERATED_REPORTS_DIRECTORY = './test-output/vitest/coverage';

/**
 * The coverage directory for a project, as a path relative to the project root
 * (vitest resolves `reportsDirectory` against the config's `root`).
 *
 * Coverage lands under the workspace's `dist` rather than inside the project, so
 * the HTML reporter's vendored assets are neither formatted by the `format`
 * target nor counted as an input to the project's own tasks.
 */
export const getCoverageReportsDirectory = (dir: string): string =>
  joinPathFragments(
    relative(join('/', dir), '/'),
    'dist',
    dir,
    'test-output/vitest/coverage',
  );

/**
 * Point coverage at the project's `dist` directory.
 *
 * `@nx/vitest` writes `reportsDirectory: './test-output/vitest/coverage'`, which
 * resolves inside the project. Coverage is off by default, so the directory is
 * dormant until someone runs `vitest --coverage` — at which point the HTML
 * reporter's bundled third-party scripts land in the project, where the `format`
 * target reformats them (failing the build from then on) and the `default` named
 * input counts them, so no task in the project can ever be cached again.
 *
 * Anchored to the exact literal `@nx/vitest` generates, and scoped to the
 * `coverage` block of the config's own `test` object, so a directory the user has
 * repointed is left alone.
 */
const coverageReportsDirectoryPattern = (dir: string): string =>
  `\`test: { $props }\` where {
  $props <: within \`defineConfig($_)\`,
  $props <: some \`coverage: { $cov }\`,
  $cov <: some \`reportsDirectory: '${GENERATED_REPORTS_DIRECTORY}'\` as $reportsDirectory,
  $reportsDirectory => \`reportsDirectory: '${getCoverageReportsDirectory(dir)}'\`
}`;

/** Dependencies a caller must declare to configure vitest. */
export const VITEST_DEPENDENCIES = [
  { name: 'vite' },
  { name: 'vitest' },
  { name: '@vitest/coverage-v8' },
] as const satisfies readonly { name: ITsDepVersion }[];

export const configureVitest = async <const D extends DependencyDeclaration>(
  tree: Tree,
  options: ConfigureProjectOptions,
  declaration: D & MustDeclare<typeof VITEST_DEPENDENCIES, D>,
) => {
  // Find vitest.config.mts or vite.config.mts
  const configPath = [
    join(options.dir, 'vitest.config.mts'),
    join(options.dir, 'vite.config.mts'),
  ].find((config) => tree.exists(config));

  if (configPath) {
    await applyGritQL(
      tree,
      configPath,
      readGritPattern('vitest-pass-with-no-tests'),
    );

    await applyGritQL(tree, configPath, ROOT_IMPORT_META_DIRNAME);

    await applyGritQL(
      tree,
      configPath,
      coverageReportsDirectoryPattern(options.dir),
    );

    const nxJson = readNxJson(tree);
    updateNxJson(tree, {
      ...nxJson,
      targetDefaults: {
        ...(nxJson.targetDefaults ?? {}),
        '@nx/vitest:test': {
          cache: true,
          inputs: ['default', '^production'],
          configurations: {
            'update-snapshot': {
              args: '--update',
            },
          },
          ...nxJson.targetDefaults['@nx/vitest:test'],
        },
      },
    });
  }

  addDependenciesToPackageJson(
    tree,
    {},
    withVersions(forDependencies<typeof VITEST_DEPENDENCIES>(declaration), [
      'vite',
      'vitest',
      '@vitest/coverage-v8',
    ]),
  );
};
