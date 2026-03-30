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
  updateJson,
} from '@nx/devkit';
import { TS_VERSIONS, withVersions } from '../../utils/versions';
import { factory, ArrayLiteralExpression, SyntaxKind } from 'typescript';
import {
  addDestructuredImport,
  addSingleImport,
  query,
  replace,
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
    withVersions([
      'eslint',
      '@eslint/js',
      'typescript-eslint',
      'prettier',
      'eslint-plugin-prettier',
      'jsonc-eslint-parser',
    ]),
  );

  // Add overrides for ESLint 10 to handle npm's strict peer dependency resolution.
  // Some ESLint plugins haven't updated their peer deps to include ESLint 10 yet.
  const eslintVersion = TS_VERSIONS['eslint'];
  updateJson(tree, 'package.json', (json) => ({
    ...json,
    // npm overrides
    overrides: {
      ...json.overrides,
      eslint: eslintVersion,
    },
    // yarn resolutions
    resolutions: {
      ...json.resolutions,
      eslint: eslintVersion,
    },
    // pnpm overrides
    pnpm: {
      ...json.pnpm,
      overrides: {
        ...json.pnpm?.overrides,
        eslint: eslintVersion,
      },
    },
  }));

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

    // Check if eslintPluginPrettierRecommended exists in exports array
    const existingPlugin = query(
      tree,
      eslintConfigPath,
      'ExportAssignment > ArrayLiteralExpression Identifier[name="eslintPluginPrettierRecommended"]',
    );

    // Add eslintPluginPrettierRecommended to array if it doesn't exist
    if (existingPlugin.length === 0) {
      replace(
        tree,
        eslintConfigPath,
        'ExportAssignment > ArrayLiteralExpression',
        (node: ArrayLiteralExpression) => {
          return factory.createArrayLiteralExpression(
            [
              factory.createIdentifier('eslintPluginPrettierRecommended'),
              ...node.elements,
            ],
            true,
          );
        },
      );
    }

    // Add ignore patterns to eslint config
    addIgnoresToEslintConfig(tree, eslintConfigPath, [
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
/**
 * Wraps React ESLint configs with @eslint/compat's fixupConfigRules to ensure
 * compatibility with ESLint 10. Some React ESLint plugins use deprecated APIs
 * (e.g. context.getFilename()) that were removed in ESLint 10.
 */
export const fixupEslintReactConfig = async (
  tree: Tree,
  eslintConfigPath: string,
): Promise<void> => {
  if (!tree.exists(eslintConfigPath)) {
    return;
  }

  const content = tree.read(eslintConfigPath, 'utf-8');

  // Only apply if the config uses nx.configs['flat/react']
  if (!content.includes("nx.configs['flat/react']")) {
    return;
  }

  // Add the import for fixupConfigRules
  await addDestructuredImport(
    tree,
    eslintConfigPath,
    ['fixupConfigRules'],
    '@eslint/compat',
  );

  // Wrap the React config spread with fixupConfigRules
  const updated = tree
    .read(eslintConfigPath, 'utf-8')
    .replace(
      "...nx.configs['flat/react']",
      "...fixupConfigRules(nx.configs['flat/react'])",
    );
  tree.write(eslintConfigPath, updated);

  addDependenciesToPackageJson(tree, {}, withVersions(['@eslint/compat']));
};

/**
 * Adds ignore patterns to the eslint config file
 * @param tree - The file system tree
 * @param eslintConfigPath - Path to the eslint config file
 * @param ignorePatterns - Array of ignore patterns to add
 */
export const addIgnoresToEslintConfig = (
  tree: Tree,
  eslintConfigPath: string,
  ignorePatterns: string[],
): void => {
  // Check if there's an object literal with "ignores" as the key
  const existingIgnores = query(
    tree,
    eslintConfigPath,
    'ExportAssignment > ArrayLiteralExpression ObjectLiteralExpression > PropertyAssignment[name.text="ignores"]',
  );

  // If there isn't, append one to the config with an empty list
  if (existingIgnores.length === 0) {
    replace(
      tree,
      eslintConfigPath,
      'ExportAssignment > ArrayLiteralExpression',
      (node: ArrayLiteralExpression) => {
        return factory.createArrayLiteralExpression(
          [
            ...node.elements,
            factory.createObjectLiteralExpression(
              [
                factory.createPropertyAssignment(
                  factory.createIdentifier('ignores'),
                  factory.createArrayLiteralExpression([], true),
                ),
              ],
              true,
            ),
          ],
          true,
        );
      },
    );
  }

  // Create set of ignore patterns for filtering
  const ignorePatternSet = new Set(ignorePatterns);

  // Call replace on the ignores array
  replace(
    tree,
    eslintConfigPath,
    'ExportAssignment > ArrayLiteralExpression ObjectLiteralExpression > PropertyAssignment[name.text="ignores"] > ArrayLiteralExpression',
    (node: ArrayLiteralExpression) => {
      return factory.createArrayLiteralExpression(
        [
          ...node.elements.filter(
            (p) =>
              p.kind !== SyntaxKind.StringLiteral ||
              !ignorePatternSet.has(p.getText().slice(1, -1)), // remove quotes
          ),
          ...ignorePatterns.map((pattern) =>
            factory.createStringLiteral(pattern),
          ),
        ],
        true,
      );
    },
  );
};
