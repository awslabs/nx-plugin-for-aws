/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { ast, NodeTransformer, tsquery } from '@phenomnomnominal/tsquery';
import {
  factory,
  ImportClause,
  ImportSpecifier,
  JsxChild,
  JsxClosingElement,
  JsxOpeningElement,
  Node,
  Expression,
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
  from: string,
): string => {
  assertFilePath(tree, filePath);
  const contents = tree.read(filePath).toString();
  const sourceAst = ast(contents);
  // Check if any of the variables are already imported from the same module
  const existingImports: ImportSpecifier[] = tsquery.query(
    sourceAst,
    `ImportDeclaration[moduleSpecifier.text="${from}"] ImportClause ImportSpecifier`,
  );
  const existingVariables = new Set(
    existingImports.map((node) => {
      const importSpecifier = node as ImportSpecifier;
      return importSpecifier.name.escapedText.toString();
    }),
  );
  // Filter out variables that are already imported
  const newVariables = variableNames.filter(
    (name) =>
      !existingVariables.has(
        name.includes(' as ') ? name.split(' as ')[1] : name,
      ),
  );
  if (newVariables.length === 0) {
    return contents;
  }
  const destructuredImport = factory.createImportDeclaration(
    undefined,
    factory.createImportClause(
      false,
      undefined,
      factory.createNamedImports([
        ...existingImports,
        ...newVariables.map((variableName) => {
          const [name, alias] = variableName.split(' as ');
          return factory.createImportSpecifier(
            false,
            alias ? factory.createIdentifier(name) : undefined,
            factory.createIdentifier(alias || name),
          );
        }),
      ]),
    ) as ImportClause,
    factory.createStringLiteral(from, true),
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
  from: string,
): string => {
  assertFilePath(tree, filePath);
  const contents = tree.read(filePath).toString();
  const sourceAst = ast(contents);
  // Check if the import already exists
  const existingImports = tsquery.query(
    sourceAst,
    `ImportDeclaration[moduleSpecifier.text="${from}"] ImportClause > Identifier[text="${variableName}"]`,
  );
  if (existingImports.length > 0) {
    return contents;
  }
  const importDeclaration = factory.createImportDeclaration(
    undefined,
    factory.createImportClause(
      false,
      factory.createIdentifier(variableName),
      undefined,
    ) as ImportClause,
    factory.createStringLiteral(from),
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
      `ExportDeclaration StringLiteral[text="${from}"]`,
    ).length > 0;
  if (!hasExport) {
    const exportDeclaration = factory.createExportDeclaration(
      undefined,
      undefined,
      undefined,
      factory.createStringLiteral(from),
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
  errorIfNoMatches = true,
) => {
  assertFilePath(tree, filePath);
  const source = tree.read(filePath).toString();
  if (errorIfNoMatches) {
    const queryNodes = tsquery.query(ast(source), selector);
    if (queryNodes.length === 0) {
      throw new Error(
        `Could not locate an element in ${filePath} matching ${selector}`,
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
  children: readonly JsxChild[],
) =>
  factory.createJsxElement(
    factory.createJsxOpeningElement(
      factory.createIdentifier(identifier),
      undefined,
      factory.createJsxAttributes([]),
    ),
    children,
    factory.createJsxClosingElement(factory.createIdentifier(identifier)),
  );
export const createJsxElement = (
  openingElement: JsxOpeningElement,
  children: readonly JsxChild[],
  closingElement: JsxClosingElement,
) => factory.createJsxElement(openingElement, children, closingElement);

/**
 * Convert a given json object to its AST representation
 */
export const jsonToAst = (obj: unknown): Node => {
  if (obj === null) {
    return factory.createNull();
  }

  if (obj === undefined) {
    return factory.createIdentifier('undefined');
  }

  if (typeof obj === 'string') {
    return factory.createStringLiteral(obj);
  }

  if (typeof obj === 'number') {
    return factory.createNumericLiteral(obj);
  }

  if (typeof obj === 'boolean') {
    return obj ? factory.createTrue() : factory.createFalse();
  }

  if (Array.isArray(obj)) {
    return factory.createArrayLiteralExpression(
      obj.map((item) => jsonToAst(item) as Expression),
    );
  }

  if (typeof obj === 'object') {
    return factory.createObjectLiteralExpression(
      Object.entries(obj).map(([key, value]) => {
        // Check if the key is a valid identifier
        const isValidIdentifier = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key);
        return factory.createPropertyAssignment(
          isValidIdentifier
            ? factory.createIdentifier(key)
            : factory.createStringLiteral(key),
          jsonToAst(value) as Expression,
        );
      }),
    );
  }

  throw new Error(`Unsupported type: ${typeof obj}`);
};

/**
 * Return whether or not the given identifier is exported in the source file
 */
export const hasExportDeclaration = (
  source: string,
  identifierName: string,
): boolean => {
  const sourceFile = ast(source);
  return (
    tsquery.query(
      sourceFile,
      `ExportDeclaration:has(ExportSpecifier:has(Identifier[name="${identifierName}"]))`,
    ).length > 0 ||
    tsquery.query(
      sourceFile,
      `TypeAliasDeclaration:has(ExportKeyword):has(Identifier[name="${identifierName}"])`,
    ).length > 0
  );
};
