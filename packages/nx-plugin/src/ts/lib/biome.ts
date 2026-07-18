/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  readNxJson,
  type Tree,
  updateNxJson,
  updateProjectConfiguration,
} from '@nx/devkit';
import { readProjectConfigurationUnqualified } from '../../utils/nx';
import { sortObjectKeys } from '../../utils/object';
import type { ConfigureProjectOptions } from './types';

export const configureBiomeLint = async (
  tree: Tree,
  options: ConfigureProjectOptions,
) => {
  const projectJson = readProjectConfigurationUnqualified(
    tree,
    options.fullyQualifiedName,
  );

  const biomeConfigured = tree.exists('biome.json');

  // When there's no root Biome configuration (eg the user removed it), make the
  // lint target a no-op rather than failing on a missing config.
  const lintTarget = biomeConfigured
    ? {
        executor: 'nx:run-commands',
        cache: true,
        inputs: ['biome'],
        options: {
          command: 'biome lint {projectRoot}',
        },
        configurations: {
          fix: {
            command: 'biome check --write {projectRoot}',
          },
          'skip-lint': {
            // Cross-platform no-op (`true` is not available on Windows cmd).
            command: 'node -e ""',
          },
        },
        // Format before linting so any fixable formatting issues (eg line too
        // long) are resolved first, mirroring the Python project generator.
        dependsOn: ['format'],
      }
    : { executor: 'nx:noop' };

  // The base format target checks formatting (failing when files aren't
  // formatted); the `fix` configuration writes the changes. `skip-lint` is a
  // no-op so `nx lint --configuration=skip-lint` propagates cleanly through the
  // lint -> format dependency edge.
  const formatTarget = biomeConfigured
    ? {
        executor: 'nx:run-commands',
        cache: true,
        inputs: ['biome'],
        options: {
          command: 'biome format {projectRoot}',
        },
        configurations: {
          fix: {
            command: 'biome format --write {projectRoot}',
          },
          'skip-lint': {
            // Cross-platform no-op (`true` is not available on Windows cmd).
            command: 'node -e ""',
          },
        },
      }
    : { executor: 'nx:noop' };

  updateProjectConfiguration(tree, options.fullyQualifiedName, {
    ...projectJson,
    // Sort targets so the lint and format targets land in deterministic
    // positions regardless of whether they already existed (keeps re-runs
    // stable)
    targets: sortObjectKeys({
      ...projectJson?.targets,
      format: formatTarget,
      lint: lintTarget,
    }),
  });

  // Register the `biome` named input so lint targets are cache-invalidated when
  // the root biome.json changes.
  const nxJson = readNxJson(tree);
  if (
    !nxJson.namedInputs?.biome ||
    !nxJson.namedInputs.biome.includes('{workspaceRoot}/biome.json')
  ) {
    updateNxJson(tree, {
      ...nxJson,
      namedInputs: {
        ...nxJson.namedInputs,
        biome: ['default', '{workspaceRoot}/biome.json'],
      },
    });
  }
};
