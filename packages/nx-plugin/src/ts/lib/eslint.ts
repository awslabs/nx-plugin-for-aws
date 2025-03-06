/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Tree,
  updateNxJson,
  readNxJson,
  addDependenciesToPackageJson,
} from '@nx/devkit';
import { withVersions } from '../../utils/versions';
import { factory, ArrayLiteralExpression } from 'typescript';
import { addSingleImport, query, replace } from '../../utils/ast';

export const configureEslint = (tree: Tree) => {
  // Configure the lint task
  let nxJson = readNxJson(tree);
  if (
    !nxJson.plugins
      ?.filter((e) => typeof e !== 'string')
      .some((e) => e.plugin === '@nx/eslint/plugin')
  ) {
    updateNxJson(tree, {
      ...nxJson,
      plugins: [
        ...(nxJson.plugins ?? []),
        {
          plugin: '@nx/eslint/plugin',
          options: {
            targetName: 'lint',
          },
        },
      ],
    });
  }

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

    // Check if ignores array exists in any object literal
    const existingIgnores = query(
      tree,
      eslintConfigPath,
      'ExportAssignment > ArrayLiteralExpression ObjectLiteralExpression > PropertyAssignment[name.text="ignores"]',
    );

    if (existingIgnores.length > 0) {
      // Check if the entry already exists in the ignores array
      const timestampIgnore = query(
        tree,
        eslintConfigPath,
        'ExportAssignment > ArrayLiteralExpression ObjectLiteralExpression > PropertyAssignment[name.text="ignores"] > ArrayLiteralExpression StringLiteral[value="**/vite.config.ts.timestamp*"]',
      );

      if (timestampIgnore.length === 0) {
        // Add to existing ignores array only if entry doesn't exist
        replace(
          tree,
          eslintConfigPath,
          'ExportAssignment > ArrayLiteralExpression ObjectLiteralExpression > PropertyAssignment[name.text="ignores"] > ArrayLiteralExpression',
          (node: ArrayLiteralExpression) => {
            return factory.createArrayLiteralExpression(
              [
                ...node.elements,
                factory.createStringLiteral('**/vite.config.ts.timestamp*'),
              ],
              true,
            );
          },
        );
      }
    } else {
      // Create new object with ignores array
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
                    factory.createArrayLiteralExpression(
                      [
                        factory.createStringLiteral(
                          '**/vite.config.ts.timestamp*',
                        ),
                      ],
                      true,
                    ),
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

    nxJson = readNxJson(tree);
    updateNxJson(tree, {
      ...nxJson,
      targetDefaults: {
        ...(nxJson.targetDefaults ?? {}),
        lint: {
          ...nxJson.targetDefaults?.lint,
          cache: true,
          configurations: {
            fix: {
              fix: true,
            },
          },
          inputs: [
            'default',
            '{workspaceRoot}/eslint.config.mjs',
            '{projectRoot}/eslint.config.mjs',
          ],
        },
      },
    });
  }
};
