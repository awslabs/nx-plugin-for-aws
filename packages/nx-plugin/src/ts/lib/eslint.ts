/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Tree,
  updateNxJson,
  readNxJson,
  addDependenciesToPackageJson,
  updateProjectConfiguration,
} from '@nx/devkit';
import { withVersions } from '../../utils/versions';
import {
  addSingleImport,
  applyGritQLTransform,
  hasGritQLMatch,
} from '../../utils/ast';
import { ConfigureProjectOptions } from './types';
import { readProjectConfigurationUnqualified } from '../../utils/nx';

export const configureEslint = async (
  tree: Tree,
  options: ConfigureProjectOptions,
) => {
  // Configure the lint task
  const projectJson = readProjectConfigurationUnqualified(
    tree,
    options.fullyQualifiedName,
  );
  updateProjectConfiguration(tree, options.fullyQualifiedName, {
    ...projectJson,
    targets: {
      ...projectJson?.targets,
      lint: {
        executor: '@nx/eslint:lint',
        cache: true,
        inputs: ['eslint'],
        configurations: {
          fix: {
            fix: true,
          },
          'skip-lint': {
            force: true,
          },
        },
      },
    },
  });

  addDependenciesToPackageJson(
    tree,
    {},
    withVersions(['prettier', 'eslint-plugin-prettier', 'jsonc-eslint-parser']),
  );

  // Update or create eslint.config.mjs
  const eslintConfigPath = 'eslint.config.mjs';

  if (tree.exists(eslintConfigPath)) {
    // Add import if it doesn't exist
    await addSingleImport(
      tree,
      eslintConfigPath,
      'eslintPluginPrettierRecommended',
      'eslint-plugin-prettier/recommended',
    );

    // Prepend eslintPluginPrettierRecommended to the exports array if not present
    await applyGritQLTransform(
      tree,
      eslintConfigPath,
      'or { `export default []` => `export default [eslintPluginPrettierRecommended]`, `export default [$items]` => `export default [eslintPluginPrettierRecommended, $items]` where { $items <: not contains `eslintPluginPrettierRecommended` } }',
    );

    // Add ignore patterns to eslint config
    await addIgnoresToEslintConfig(tree, eslintConfigPath, [
      '**/vite.config.*.timestamp*',
    ]);

    const nxJson = readNxJson(tree);
    updateNxJson(tree, {
      ...nxJson,
      namedInputs: {
        ...nxJson.namedInputs,
        eslint: [
          'default',
          '{workspaceRoot}/eslint.config.mjs',
          '{projectRoot}/eslint.config.mjs',
        ],
      },
    });
  }
};

/**
 * Adds ignore patterns to the eslint config file
 * @param tree - The file system tree
 * @param eslintConfigPath - Path to the eslint config file
 * @param ignorePatterns - Array of ignore patterns to add
 */
export const addIgnoresToEslintConfig = async (
  tree: Tree,
  eslintConfigPath: string,
  ignorePatterns: string[],
): Promise<void> => {
  // Add { ignores: [] } to the config array if no ignores object exists
  // Check for any 'ignores:' property assignment in the file (specific enough for eslint configs)
  const hasIgnores = await hasGritQLMatch(
    tree,
    eslintConfigPath,
    '`ignores: $_`',
  );
  if (!hasIgnores) {
    await applyGritQLTransform(
      tree,
      eslintConfigPath,
      '`export default [$items]` where { $items += `{ ignores: [] }` }',
    );
  }

  // Add each ignore pattern if not already present
  for (const pattern of ignorePatterns) {
    const escaped = pattern.replace(/`/g, '\\`');
    // Handle empty ignores array, then append to non-empty via +=
    await applyGritQLTransform(
      tree,
      eslintConfigPath,
      `\`ignores: []\` => \`ignores: ['${escaped}']\``,
    );
    await applyGritQLTransform(
      tree,
      eslintConfigPath,
      `\`ignores: [$items]\` where { $items <: not some \`'${escaped}'\`, $items += \`'${escaped}'\` }`,
    );
  }
};
