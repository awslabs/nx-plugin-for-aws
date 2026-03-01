/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readNxJson, Tree, updateNxJson } from '@nx/devkit';
import { join } from 'path';
import ts, { factory, ObjectLiteralExpression } from 'typescript';
import { ConfigureProjectOptions } from './types';
import { replaceIfExists } from '../../utils/ast';

export const configureVitest = (
  tree: Tree,
  options: ConfigureProjectOptions,
) => {
  // Find vitest.config.mts or vite.config.mts
  const configPath = [
    join(options.dir, 'vitest.config.mts'),
    join(options.dir, 'vite.config.mts'),
  ].find((config) => tree.exists(config));

  if (configPath) {
    replaceIfExists(
      tree,
      configPath,
      'CallExpression:has(Identifier[name="defineConfig"]) PropertyAssignment:has(Identifier[name="test"]) ObjectLiteralExpression',
      (node: ObjectLiteralExpression) => {
        // Check if passWithNoTests already exists
        const hasPassWithNoTests = node.properties.some(
          (p) =>
            ts.isPropertyAssignment(p) &&
            ts.isIdentifier(p.name) &&
            p.name.text === 'passWithNoTests',
        );
        if (!hasPassWithNoTests) {
          return factory.createObjectLiteralExpression([
            ...node.properties,
            factory.createPropertyAssignment(
              'passWithNoTests',
              factory.createTrue(),
            ),
          ]);
        }
        return node;
      },
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
};
