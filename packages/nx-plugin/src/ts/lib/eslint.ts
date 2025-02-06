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
import { ast, tsquery } from '@phenomnomnominal/tsquery';
import { factory, ArrayLiteralExpression } from 'typescript';
import { singleImport } from '../../utils/ast';
export const configureEslint = async (tree: Tree) => {
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
    const eslintConfigContent = tree.read(eslintConfigPath).toString();
    const sourceFile = ast(eslintConfigContent);
    // Check if import exists
    const existingImport = tsquery.query(
      sourceFile,
      'VariableDeclaration[name.text="eslintPluginPrettierRecommended"]',
    );
    let updatedContent = sourceFile;
    // Add import if it doesn't exist
    if (existingImport.length === 0) {
      updatedContent = ast(
        singleImport(
          tree,
          eslintConfigPath,
          'eslintPluginPrettierRecommended',
          'eslint-plugin-prettier/recommended',
        ),
      );
    }
    // Check if eslintPluginPrettierRecommended exists in exports array
    const existingPlugin = tsquery.query(
      updatedContent,
      'ExportAssignment > ArrayLiteralExpression Identifier[name="eslintPluginPrettierRecommended"]',
    );
    // Add eslintPluginPrettierRecommended to array if it doesn't exist
    if (existingPlugin.length === 0) {
      updatedContent = tsquery.map(
        updatedContent,
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
    // Only write if changes were made
    if (updatedContent !== sourceFile) {
      tree.write(eslintConfigPath, updatedContent.getFullText());
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
