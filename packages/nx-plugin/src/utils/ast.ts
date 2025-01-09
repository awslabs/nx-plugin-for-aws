/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import {
  ast,
  NodeTransformer,
  StringTransformer,
  tsquery,
} from '@phenomnomnominal/tsquery';
import {
  factory,
  ImportClause,
  JsxChild,
  JsxClosingElement,
  JsxOpeningElement,
  SourceFile,
} from 'typescript';

const assertFilePath = (tree: Tree, filePath: string) => {
  if (!tree.exists(filePath)) {
    throw new Error(`No file located at ${filePath}`);
  }
};

export const destructuredImport = (
  tree: Tree,
  filePath: string,
  variableNames: string[],
  from: string
): string => {
  assertFilePath(tree, filePath);

  const contents = tree.read(filePath).toString();

  const destructuredImport = factory.createImportDeclaration(
    undefined,
    factory.createImportClause(
      false,
      undefined,
      factory.createNamedImports(
        variableNames.map((variableName) =>
          factory.createImportSpecifier(
            false,
            undefined,
            factory.createIdentifier(variableName)
          )
        )
      )
    ) as ImportClause,
    factory.createStringLiteral(from, true)
  );

  const updatedContents = tsquery
    .map(ast(contents), 'SourceFile', (node: SourceFile) => {
      return {
        ...node,
        statements: [destructuredImport, ...node.statements],
      };
    })
    .getFullText();

  if (contents !== updatedContents) {
    tree.write(filePath, updatedContents);
  }

  return updatedContents;
};

export const singleImport = (
  tree: Tree,
  filePath: string,
  variableName: string,
  from: string
): string => {
  assertFilePath(tree, filePath);
  const contents = tree.read(filePath).toString();

  const importDeclaration = factory.createImportDeclaration(
    undefined,
    factory.createImportClause(
      false,
      factory.createIdentifier(variableName),
      undefined
    ) as ImportClause,
    factory.createStringLiteral(from)
  );

  const updatedContents = tsquery
    .map(ast(contents), 'SourceFile', (node: SourceFile) => {
      return {
        ...node,
        statements: [importDeclaration, ...node.statements],
      };
    })
    .getFullText();

  if (contents !== updatedContents) {
    tree.write(filePath, updatedContents);
  }

  return updatedContents;
};

export const addStarExport = (tree: Tree, filePath: string, from: string) => {
  const indexContents = tree.exists(filePath)
    ? tree.read(filePath).toString()
    : '';

  const hasExport =
    tsquery.query(
      ast(indexContents),
      `ExportDeclaration StringLiteral[text="${from}"]`
    ).length > 0;

  if (!hasExport) {
    const exportDeclaration = factory.createExportDeclaration(
      undefined,
      undefined,
      undefined,
      factory.createStringLiteral(from)
    );

    const updatedIndexContents = tsquery
      .map(ast(indexContents), 'SourceFile', (node: SourceFile) => ({
        ...node,
        statements: [exportDeclaration, ...node.statements],
      }))
      .getFullText();

    if (indexContents !== updatedIndexContents) {
      tree.write(filePath, updatedIndexContents);
    }
  }
};

export const replace = (
  tree: Tree,
  filePath: string,
  selector: string,
  transformer: NodeTransformer,
  errorIfNoMatches = true
) => {
  assertFilePath(tree, filePath);
  const source = tree.read(filePath).toString();

  if (errorIfNoMatches) {
    const queryNodes = tsquery.query(ast(source), selector);
    if (queryNodes.length === 0) {
      throw new Error(
        `Could not locate a element im ${filePath} matching ${selector}`
      );
    }
  }

  const updatedSource = tsquery
    .map(ast(source), selector, transformer)
    .getFullText();

  if (source !== updatedSource) {
    tree.write(filePath, updatedSource);
  }
};

export const createJsxElementFromIdentifier = (
  identifier: string,
  children: readonly JsxChild[]
) =>
  factory.createJsxElement(
    factory.createJsxOpeningElement(
      factory.createIdentifier(identifier),
      undefined,
      factory.createJsxAttributes([])
    ),
    children,
    factory.createJsxClosingElement(factory.createIdentifier(identifier))
  );

export const createJsxElement = (
  openingElement: JsxOpeningElement,
  children: readonly JsxChild[],
  closingElement: JsxClosingElement
) => factory.createJsxElement(openingElement, children, closingElement);
