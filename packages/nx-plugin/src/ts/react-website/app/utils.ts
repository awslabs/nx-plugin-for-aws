/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import {
  createSourceFile,
  isExportAssignment,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isStringLiteral,
  ScriptTarget,
} from 'typescript';
import { resolveUxProvider, UxProvider } from '../../../utils/ux';

export async function readUxProviderFromConfig(
  tree: Tree,
  configPath: string,
): Promise<UxProvider> {
  if (!tree.exists(configPath)) {
    throw new Error(`uxProvider: expected config file at ${configPath}`);
  }

  const content = tree.read(configPath, 'utf-8');
  if (!content) {
    throw new Error(`uxProvider: unable to read config file at ${configPath}`);
  }

  let uxProviderCandidate: string | undefined;
  const sourceFile = createSourceFile(
    configPath,
    content.toString(),
    ScriptTarget.Latest,
    true,
  );

  sourceFile.forEachChild((node) => {
    if (
      isExportAssignment(node) &&
      isObjectLiteralExpression(node.expression)
    ) {
      node.expression.properties.forEach((prop) => {
        if (
          isPropertyAssignment(prop) &&
          prop.name.getText() === 'uxProvider' &&
          isStringLiteral(prop.initializer)
        ) {
          uxProviderCandidate = prop.initializer.text;
        }
      });
    }
  });

  if (!uxProviderCandidate) {
    throw new Error(
      `uxProvider: expected "uxProvider" property in ${configPath}`,
    );
  }

  return resolveUxProvider(tree, uxProviderCandidate as UxProvider);
}
