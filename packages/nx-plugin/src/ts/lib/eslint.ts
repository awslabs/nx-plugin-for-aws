/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  readProjectConfiguration,
  Tree,
  updateProjectConfiguration,
  updateNxJson,
  readNxJson,
  addDependenciesToPackageJson,
} from '@nx/devkit';
import { ConfigureProjectOptions } from './types';
import { withVersions } from '../../utils/versions';
import { ast, tsquery } from '@phenomnomnominal/tsquery';
import {
  factory,
  SourceFile,
  ArrayLiteralExpression,
  NodeFlags,
} from 'typescript';
export const configureEslint = async (
  tree: Tree,
  options: ConfigureProjectOptions
) => {
  // Configure the lint task
  const projectConfiguration = readProjectConfiguration(
    tree,
    options.fullyQualifiedName
  );
  if (!projectConfiguration.targets.lint) {
    projectConfiguration.targets.lint = {
      executor: '@nx/eslint:lint',
      options: {
        fix: true,
      },
    };
    updateProjectConfiguration(
      tree,
      options.fullyQualifiedName,
      projectConfiguration
    );
  }
  addDependenciesToPackageJson(
    tree,
    {},
    withVersions(['prettier', 'eslint-plugin-prettier'])
  );
  // Update or create eslint.config.cjs
  const eslintConfigPath = 'eslint.config.cjs';
  if (tree.exists(eslintConfigPath)) {
    const eslintConfigContent = tree.read(eslintConfigPath).toString();
    const sourceFile = ast(eslintConfigContent);
    // Check if import exists
    const existingImport = tsquery.query(
      sourceFile,
      'VariableDeclaration[name.text="eslintPluginPrettierRecommended"]'
    );
    let updatedContent = sourceFile;
    // Add import if it doesn't exist
    if (existingImport.length === 0) {
      const importDeclaration = factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList(
          [
            factory.createVariableDeclaration(
              factory.createIdentifier('eslintPluginPrettierRecommended'),
              undefined,
              undefined,
              factory.createCallExpression(
                factory.createIdentifier('require'),
                undefined,
                [
                  factory.createStringLiteral(
                    'eslint-plugin-prettier/recommended'
                  ),
                ]
              )
            ),
          ],
          NodeFlags.Const
        )
      );
      updatedContent = tsquery.map(
        updatedContent,
        'SourceFile',
        (node: SourceFile) => {
          return factory.updateSourceFile(node, [
            importDeclaration,
            ...node.statements,
          ]);
        }
      );
    }
    // Check if eslintPluginPrettierRecommended exists in module.exports array
    const existingPlugin = tsquery.query(
      updatedContent,
      'BinaryExpression:has(Identifier[name="module"]):has(Identifier[name="exports"]) > ArrayLiteralExpression Identifier[name="eslintPluginPrettierRecommended"]'
    );
    // Add eslintPluginPrettierRecommended to array if it doesn't exist
    if (existingPlugin.length === 0) {
      updatedContent = tsquery.map(
        updatedContent,
        'BinaryExpression:has(Identifier[name="module"]):has(Identifier[name="exports"]) > ArrayLiteralExpression',
        (node: ArrayLiteralExpression) => {
          return factory.createArrayLiteralExpression(
            [
              factory.createIdentifier('eslintPluginPrettierRecommended'),
              ...node.elements,
            ],
            true
          );
        }
      );
    }
    // Only write if changes were made
    if (updatedContent !== sourceFile) {
      tree.write(eslintConfigPath, updatedContent.getFullText());
    }

    const nxJson = readNxJson(tree);
    updateNxJson(tree, {
      ...nxJson,
      targetDefaults: {
        ...(nxJson.targetDefaults ?? {}),
        lint: {
          cache: true,
          configurations: {
            fix: {
              fix: true,
            },
          },
          inputs: [
            'default',
            '{workspaceRoot}/eslint.config.js',
            '{projectRoot}/eslint.config.js',
          ],
        },
      },
    });
  }
};
