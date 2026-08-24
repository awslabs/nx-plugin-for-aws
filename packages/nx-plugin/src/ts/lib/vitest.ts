/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readNxJson, type Tree, updateNxJson } from '@nx/devkit';
import { readFileSync } from 'fs';
import { join } from 'path';
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
