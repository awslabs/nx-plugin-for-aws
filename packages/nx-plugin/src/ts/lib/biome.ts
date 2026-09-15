/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  readNxJson,
  type TargetConfiguration,
  type Tree,
  updateNxJson,
  updateProjectConfiguration,
} from '@nx/devkit';
import { readProjectConfigurationUnqualified } from '../../utils/nx.js';
import { sortObjectKeys } from '../../utils/object.js';
import type { ConfigureProjectOptions } from './types.js';

/**
 * The `format` and `lint` targets every Biome-linted project gets, so a project
 * that isn't scaffolded by `ts#project` (e.g. an AgentCore Gateway hosting only
 * `local-dev.ts`) is linted identically rather than by its own copy.
 *
 * When there's no root Biome configuration (eg the user removed it), the targets
 * are no-ops rather than failing on a missing config.
 */
export const biomeTargets = (
  tree: Tree,
): Record<'format' | 'lint', TargetConfiguration> => {
  if (!tree.exists('biome.json')) {
    return { format: { executor: 'nx:noop' }, lint: { executor: 'nx:noop' } };
  }
  return {
    // The base format target checks formatting (failing when files aren't
    // formatted); the `fix` configuration writes the changes. `skip-lint` is a
    // no-op so `nx lint --configuration=skip-lint` propagates cleanly through
    // the lint -> format dependency edge.
    format: {
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
    },
    lint: {
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
          command: 'node -e ""',
        },
      },
      // Format before linting so any fixable formatting issues (eg line too
      // long) are resolved first, mirroring the Python project generator.
      dependsOn: ['format'],
    },
  };
};

/**
 * Register the `biome` named input so lint targets are cache-invalidated when
 * the root biome.json changes.
 */
export const registerBiomeNamedInput = (tree: Tree): void => {
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

export const configureBiomeLint = async (
  tree: Tree,
  options: ConfigureProjectOptions,
) => {
  const projectJson = readProjectConfigurationUnqualified(
    tree,
    options.fullyQualifiedName,
  );

  updateProjectConfiguration(tree, options.fullyQualifiedName, {
    ...projectJson,
    // Sort targets so the lint and format targets land in deterministic
    // positions regardless of whether they already existed (keeps re-runs
    // stable)
    targets: sortObjectKeys({
      ...projectJson?.targets,
      ...biomeTargets(tree),
    }),
  });

  registerBiomeNamedInput(tree);
};
