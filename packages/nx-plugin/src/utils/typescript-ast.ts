/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { tsquery, ast } from '@phenomnomnominal/tsquery';
import { factory, ImportClause, JsxSelfClosingElement, SourceFile } from 'typescript';

/**
 * Write export declarations to the given typescript file
 */
export const writeExportDeclarations = (
  tree: Tree,
  typescriptFilePath: string,
  exportDeclarations: string[]
): void => {
  const typescriptFileContents = tree.read(typescriptFilePath).toString();

  const updatedFileContents = addExportDeclarations(typescriptFileContents, exportDeclarations);

  if (typescriptFileContents !== updatedFileContents) {
    tree.write(typescriptFilePath, updatedFileContents);
  }
};

/**
 * Add export declarations to the given typescript file contents
 * @returns the updated file contents
 */
export const addExportDeclarations = (typescriptFileContents: string, exportDeclarations: string[]): string => {
  const exportDeclarationStatements = exportDeclarations.map(
    (exportDeclaration) =>
      factory.createExportDeclaration(
        undefined,
        undefined,
        undefined,
        factory.createStringLiteral(exportDeclaration, true)
      )
  );

  return tsquery
    .map(ast(typescriptFileContents), 'SourceFile', (node: SourceFile) => {
      return {
        ...node,
        statements: [...exportDeclarationStatements, ...node.statements],
      };
    })
    .getFullText();
};

export interface DefaultImportDeclaration {
  import: string;
  from: string;
}

/**
 * Add default imports (ie import Foo from 'bar') to a typescript file
 * @returns updated typescript file contents
 */
export const addDefaultImportDeclarations = (typescriptFileContents: string, importDeclarations: DefaultImportDeclaration[]): string => {
  const importDeclarationStatements = importDeclarations.map(importDeclaration => factory.createImportDeclaration(
    undefined,
    factory.createImportClause(
      false,
      factory.createIdentifier(importDeclaration.import),
      undefined
    ) as ImportClause,
    factory.createStringLiteral(importDeclaration.from, true)
  ));

  return tsquery
    .map(ast(typescriptFileContents), 'SourceFile', (node: SourceFile) => {
      return {
        ...node,
        statements: [...importDeclarationStatements, ...node.statements],
      };
    })
    .getFullText();
};

/**
 * Wrap the targetted jsx component with the given component, ie:
 * <Parent><Target /></Parent>
 * @returns the updated contents if the target component was found, otherwise undefined
 */
export const addJsxComponentWrapper = (typescriptFileContents: string, targetComponent: string, parentComponent: string): string | undefined => {
  let locatedNode = false;
  const updatedContents = tsquery
    .map(
      ast(typescriptFileContents),
      'JsxSelfClosingElement',
      (node: JsxSelfClosingElement) => {
        if (node.tagName.getText() !== targetComponent) {
          return node;
        } else {
          locatedNode = true;
        }

        return factory.createJsxElement(
          factory.createJsxOpeningElement(
            factory.createIdentifier(parentComponent),
            undefined,
            factory.createJsxAttributes([])
          ),
          [node],
          factory.createJsxClosingElement(
            factory.createIdentifier(parentComponent)
          )
        );
      }
    )
    .getFullText();

  return locatedNode ? updatedContents : undefined;
};
