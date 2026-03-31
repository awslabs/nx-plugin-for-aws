/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  readNxJson,
  Tree,
  updateNxJson,
} from '@nx/devkit';
import { join } from 'path';
import { ConfigureProjectOptions } from './types';
import { applyGritQLTransform } from '../../utils/ast';
import { withVersions } from '../../utils/versions';
import { readFileSync } from 'fs';

const readGritPattern = (name: string): string =>
  readFileSync(join(__dirname, 'grit', `${name}.grit`), 'utf-8').trim();

export const configureVitest = async (
  tree: Tree,
  options: ConfigureProjectOptions,
) => {
  // Find vitest.config.mts or vite.config.mts
  const configPath = [
    join(options.dir, 'vitest.config.mts'),
    join(options.dir, 'vite.config.mts'),
  ].find((config) => tree.exists(config));

  if (configPath) {
    await applyGritQLTransform(
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
    withVersions(['vite', 'vitest', '@vitest/coverage-v8']),
  );
};
