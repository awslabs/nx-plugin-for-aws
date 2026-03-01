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
import { factory, ArrayLiteralExpression, SyntaxKind } from 'typescript';
import { addSingleImport, query, replace } from '../../utils/ast';
import { ConfigureProjectOptions } from './types';
import { readProjectConfigurationUnqualified } from '../../utils/nx';

export const configureEslint = (
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
    addSingleImport(
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
