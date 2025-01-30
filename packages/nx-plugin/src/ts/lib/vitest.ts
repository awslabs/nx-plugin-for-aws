/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readNxJson, Tree, updateNxJson } from '@nx/devkit';
import { tsquery } from '@phenomnomnominal/tsquery';
import { join } from 'path';
import ts from 'typescript';
import { ConfigureProjectOptions } from './types';
const passWithNoTests = (sourceFile: ts.SourceFile): ts.SourceFile => {
  const transformer =
    <T extends ts.Node>(context: ts.TransformationContext) =>
    (rootNode: T) => {
      function visit(node: ts.Node): ts.Node {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'defineConfig' &&
          node.arguments.length === 1
        ) {
          const configObject = node.arguments[0];
          if (ts.isObjectLiteralExpression(configObject)) {
            const testProperty = configObject.properties.find(
              (p) =>
                ts.isPropertyAssignment(p) &&
                ts.isIdentifier(p.name) &&
                p.name.text === 'test'
            );
            if (testProperty && ts.isPropertyAssignment(testProperty)) {
              const testValue = testProperty.initializer;
              if (ts.isObjectLiteralExpression(testValue)) {
                // Check if passWithNoTests already exists
                const hasPassWithNoTests = testValue.properties.some(
                  (p) =>
                    ts.isPropertyAssignment(p) &&
                    ts.isIdentifier(p.name) &&
                    p.name.text === 'passWithNoTests'
                );
                if (!hasPassWithNoTests) {
                  // Add passWithNoTests: true to the test object
                  const newTestValue =
                    context.factory.updateObjectLiteralExpression(testValue, [
                      ...testValue.properties,
                      context.factory.createPropertyAssignment(
                        'passWithNoTests',
                        context.factory.createTrue()
                      ),
                    ]);
                  // Update the test property with the new value
                  const newTestProperty =
                    context.factory.updatePropertyAssignment(
                      testProperty,
                      testProperty.name,
                      newTestValue
                    );
                  // Update the config object with the new test property
                  return context.factory.updateCallExpression(
                    node,
                    node.expression,
                    node.typeArguments,
                    [
                      context.factory.updateObjectLiteralExpression(
                        configObject,
                        configObject.properties.map((p) =>
                          p === testProperty ? newTestProperty : p
                        )
                      ),
                    ]
                  );
                }
              }
            }
          }
        }
        return ts.visitEachChild(node, visit, context);
      }
      return ts.visitNode(rootNode, visit);
    };
  const result = ts.transform(sourceFile, [transformer]);
  return result.transformed[0] as ts.SourceFile;
};
export const configureVitest = (
  tree: Tree,
  options: ConfigureProjectOptions
) => {
  const configPath = join(options.dir, 'vite.config.ts');
  if (tree.exists(configPath)) {
    const originalSourceFile = tsquery.ast(tree.read(configPath, 'utf-8'));
    let sourceFile = originalSourceFile;
    sourceFile = passWithNoTests(sourceFile);
    const printer = ts.createPrinter({
      removeComments: false,
      newLine: ts.NewLineKind.LineFeed,
    });
    tree.write(
      configPath,
      printer.printNode(ts.EmitHint.Unspecified, sourceFile, originalSourceFile)
    );

    const nxJson = readNxJson(tree);
    updateNxJson(tree, {
      ...nxJson,
      targetDefaults: {
        ...(nxJson.targetDefaults ?? {}),
        '@nx/vite:test': {
          cache: true,
          inputs: ['default', '^production'],
          configurations: {
            'update-snapshot': {
              args: '--update',
            },
          },
          ...nxJson.targetDefaults['@nx/vite:test'],
        },
      },
    });
  }
};
