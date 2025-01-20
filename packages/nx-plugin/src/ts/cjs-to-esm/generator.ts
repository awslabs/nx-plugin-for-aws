/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree, getProjects } from '@nx/devkit';
import { CjsToEsmGeneratorSchema } from './schema';
import { tsquery } from '@phenomnomnominal/tsquery';
import * as ts from 'typescript';
import { minimatch } from 'minimatch';
// Replaces "module.exports = value" with "export default value"
const replaceModuleExportsWithExportDefault = (
  sourceFile: ts.SourceFile
): ts.SourceFile => {
  const transformer =
    <T extends ts.Node>(context: ts.TransformationContext) =>
    (rootNode: T) => {
      function visit(node: ts.Node): ts.Node {
        if (ts.isExpressionStatement(node)) {
          const expr = node.expression;
          if (
            ts.isBinaryExpression(expr) &&
            ts.isPropertyAccessExpression(expr.left) &&
            ts.isIdentifier(expr.left.expression) &&
            expr.left.expression.text === 'module' &&
            ts.isIdentifier(expr.left.name) &&
            expr.left.name.text === 'exports' &&
            expr.operatorToken.kind === ts.SyntaxKind.EqualsToken
          ) {
            // Create an export default statement
            return context.factory.createExportAssignment(
              undefined,
              undefined,
              expr.right
            );
          }
        }
        return ts.visitEachChild(node, visit, context);
      }
      return ts.visitNode(rootNode, visit);
    };
  const result = ts.transform(sourceFile, [transformer]);
  return result.transformed[0] as ts.SourceFile;
};
// Replaces "const x = require('y')" with "import x from 'y'"
const replaceRequires = (sourceFile: ts.SourceFile): ts.SourceFile => {
  const transformer =
    <T extends ts.Node>(context: ts.TransformationContext) =>
    (rootNode: T) => {
      function visit(node: ts.Node): ts.Node {
        if (ts.isVariableStatement(node)) {
          const declaration = node.declarationList.declarations[0];
          if (declaration && ts.isVariableDeclaration(declaration)) {
            const initializer = declaration.initializer;
            if (
              initializer &&
              ts.isCallExpression(initializer) &&
              ts.isIdentifier(initializer.expression) &&
              initializer.expression.text === 'require' &&
              initializer.arguments.length === 1
            ) {
              const modulePath = initializer.arguments[0];
              if (ts.isStringLiteral(modulePath)) {
                // Handle destructuring pattern
                if (ts.isObjectBindingPattern(declaration.name)) {
                  const importSpecifiers = declaration.name.elements
                    .map((element) => {
                      if (
                        ts.isBindingElement(element) &&
                        ts.isIdentifier(element.name)
                      ) {
                        return context.factory.createImportSpecifier(
                          false,
                          undefined,
                          element.name
                        );
                      }
                      return undefined;
                    })
                    .filter(
                      (spec): spec is ts.ImportSpecifier => spec !== undefined
                    );
                  return context.factory.createImportDeclaration(
                    undefined,
                    context.factory.createImportClause(
                      false,
                      undefined,
                      context.factory.createNamedImports(importSpecifiers)
                    ),
                    modulePath,
                    undefined
                  );
                }
                // Handle simple require
                if (ts.isIdentifier(declaration.name)) {
                  return context.factory.createImportDeclaration(
                    undefined,
                    context.factory.createImportClause(
                      false,
                      declaration.name,
                      undefined
                    ),
                    modulePath,
                    undefined
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
// Replaces requires not directly assigned to variables eg
// "const x = require('y').foo()" with
// import _import0 from 'y'
// const x = _import0.foo()
const replaceInlineRequires = (sourceFile: ts.SourceFile): ts.SourceFile => {
  let importCounter = 0;
  const imports: ts.ImportDeclaration[] = [];
  const importMap = new Map<string, string>();
  const transformer =
    <T extends ts.Node>(context: ts.TransformationContext) =>
    (rootNode: T) => {
      function visit(node: ts.Node): ts.Node {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'require' &&
          node.arguments.length === 1 &&
          ts.isStringLiteral(node.arguments[0])
        ) {
          const modulePath = node.arguments[0];
          const modulePathText = modulePath.text;
          // Check if we already have an import for this module
          if (!importMap.has(modulePathText)) {
            const importName = `_import${importCounter++}`;
            importMap.set(modulePathText, importName);
            // Create import declaration
            imports.push(
              context.factory.createImportDeclaration(
                undefined,
                context.factory.createImportClause(
                  false,
                  context.factory.createIdentifier(importName),
                  undefined
                ),
                modulePath,
                undefined
              )
            );
          }
          // Replace require() with the import reference
          return context.factory.createIdentifier(
            importMap.get(modulePathText)
          );
        }
        return ts.visitEachChild(node, visit, context);
      }
      // First pass to collect all requires and create imports
      const visited = ts.visitNode(rootNode, visit);
      // If we found any inline requires, prepend the imports to the source file
      if (imports.length > 0 && ts.isSourceFile(visited)) {
        return context.factory.updateSourceFile(visited, [
          ...imports,
          ...visited.statements,
        ]);
      }
      return visited;
    };
  const result = ts.transform(sourceFile, [transformer]);
  return result.transformed[0] as ts.SourceFile;
};
export function cjsToEsm(
  tree: Tree,
  relativePathInTree: string,
  options?: {
    include?: string[];
    exclude?: string[];
  }
) {
  const includePatterns = options?.include ?? ['**/*.{js,ts}'];
  const excludePatterns =
    options?.exclude ??
    ['node_modules', 'dist', 'build', 'tmp', '.nx'].flatMap((p) => [
      p,
      `**/${p}/**/*`,
      `${p}/**/*`,
    ]);
  // Process each TypeScript/JavaScript file in the project
  const processFile = (filePath: string) => {
    const content = tree.read(filePath, 'utf-8');
    if (!content) return;
    // Parse the source file
    const originalSourceFile = tsquery.ast(content);
    let sourceFile = originalSourceFile;
    sourceFile = replaceModuleExportsWithExportDefault(sourceFile);
    sourceFile = replaceRequires(sourceFile);
    sourceFile = replaceInlineRequires(sourceFile);
    const printer = ts.createPrinter({
      removeComments: false,
      newLine: ts.NewLineKind.LineFeed,
    });
    tree.write(
      filePath,
      printer.printNode(ts.EmitHint.Unspecified, sourceFile, originalSourceFile)
    );
  };
  // Process all files in the given directory (recursively)
  const processDirectory = (dirPath: string) => {
    const entries = tree.children(dirPath);
    entries.forEach((entry) => {
      const fullPath = `${dirPath}/${entry}`;
      const relativePath = fullPath.replace(`${relativePathInTree}/`, '');
      // Return early for exclude to ensure we don't traverse node_modules etc!
      const shouldExclude = excludePatterns.some((pattern) =>
        minimatch(relativePath, pattern)
      );
      if (shouldExclude) {
        return;
      }
      if (tree.isFile(fullPath)) {
        const shouldInclude = includePatterns.some((pattern) =>
          minimatch(relativePath, pattern)
        );
        if (shouldInclude) {
          processFile(fullPath);
        }
      } else {
        processDirectory(fullPath);
      }
    });
  };
  // Start processing from the given directories
  processDirectory(relativePathInTree);
}
export async function cjsToEsmGenerator(
  tree: Tree,
  options: CjsToEsmGeneratorSchema
) {
  // Get the project configuration
  const projects = getProjects(tree);
  const project = projects.get(options.project);
  if (!project) {
    throw new Error(`Project ${options.project} not found`);
  }
  cjsToEsm(tree, project.root, {
    include: options.include ? [options.include] : undefined,
    exclude: options.exclude ? [options.exclude] : undefined,
  });
}
export default cjsToEsmGenerator;
