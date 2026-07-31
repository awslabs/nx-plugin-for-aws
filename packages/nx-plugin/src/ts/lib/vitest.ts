/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readNxJson, type Tree, updateNxJson } from '@nx/devkit';
import { readFileSync } from 'fs';
import { join } from 'path';
import { applyGritQL } from '../../utils/ast';
import {
  type DependencyDeclaration,
  forDependencies,
  type MustDeclare,
} from '../../utils/declared-dependencies';
import { addDependenciesToPackageJson } from '../../utils/dependencies';
import { withVersions } from '../../utils/versions';
import type { ConfigureProjectOptions } from './types';

const readGritPattern = (name: string): string =>
  readFileSync(
    join(import.meta.dirname, 'grit', `${name}.grit`),
    'utf-8',
  ).trim();

/** Dependencies a caller must declare to configure vitest. */
export const VITEST_DEPENDENCIES = [
  { name: 'vite' },
  { name: 'vitest' },
  { name: '@vitest/coverage-v8' },
] as const;

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
