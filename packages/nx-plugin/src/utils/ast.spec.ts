/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import {
  ArrowFunction,
  Block,
  factory,
  InterfaceDeclaration,
  ObjectLiteralExpression,
  SyntaxKind,
  VariableDeclaration,
} from 'typescript';
import {
  addDestructuredImport,
  addSingleImport,
  addStarExport,
  replace,
  createJsxElementFromIdentifier,
  createJsxElement,
  jsonToAst,
  hasExportDeclaration,
  replaceIfExists,
  prependStatements,
  appendStatements,
} from './ast';

describe('ast utils', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  describe('destructuredImport', () => {
    it('should add new named imports', () => {
      const initialContent = `import { existingImport } from '@scope/package';`;
      tree.write('file.ts', initialContent);

      addDestructuredImport(
        tree,
        'file.ts',
        ['newImport1', 'newImport2'],
        '@scope/package',
      );

      const writtenContent = tree.read('file.ts', 'utf-8');
      expect(writtenContent).toMatch(
        /import\s*{\s*existingImport,\s*newImport1,\s*newImport2\s*}\s*from\s*["']@scope\/package["']/,
      );
    });

    it('should handle aliased imports', () => {
      const initialContent = `import { existing } from '@scope/package';`;
      tree.write('file.ts', initialContent);

      addDestructuredImport(
        tree,
        'file.ts',
        ['original as alias'],
        '@scope/package',
      );

      const writtenContent = tree.read('file.ts', 'utf-8');
      expect(writtenContent).toMatch(
        /import\s*{\s*existing,\s*original\s+as\s+alias\s*}\s*from\s*["']@scope\/package["']/,
      );
    });

    it('should not duplicate existing imports', () => {
      const initialContent = `import { existingImport } from '@scope/package';`;
      tree.write('file.ts', initialContent);

      addDestructuredImport(
        tree,
        'file.ts',
        ['existingImport'],
        '@scope/package',
      );

      const writtenContent = tree.read('file.ts', 'utf-8');
      expect(writtenContent).toBe(initialContent);
    });

    it('should throw if file does not exist', () => {
      expect(() =>
        addDestructuredImport(
          tree,
          'nonexistent.ts',
          ['import1'],
          '@scope/package',
        ),
      ).toThrow('No file located at nonexistent.ts');
    });
  });

  describe('singleImport', () => {
    it('should add new default import', () => {
      const initialContent = `// Some content`;
      tree.write('file.ts', initialContent);

      addSingleImport(tree, 'file.ts', 'DefaultImport', '@scope/package');

      const writtenContent = tree.read('file.ts', 'utf-8');
      expect(writtenContent).toMatch(
        /import\s+DefaultImport\s+from\s*["']@scope\/package["']/,
      );
    });

    it('should not duplicate existing default import', () => {
      const initialContent = `import DefaultImport from '@scope/package';`;
      tree.write('file.ts', initialContent);

      addSingleImport(tree, 'file.ts', 'DefaultImport', '@scope/package');

      const writtenContent = tree.read('file.ts', 'utf-8');
      expect(writtenContent).toBe(initialContent);
    });
  });

  describe('addStarExport', () => {
    it('should add star export if none exists', () => {
      const initialContent = `// Some content`;
      tree.write('index.ts', initialContent);

      addStarExport(tree, 'index.ts', './module');

      const writtenContent = tree.read('index.ts', 'utf-8');
      expect(writtenContent).toContain('export * from "./module"');
    });

    it('should not duplicate existing star export', () => {
      const initialContent = `export * from './module';`;
      tree.write('index.ts', initialContent);

      addStarExport(tree, 'index.ts', './module');

      const writtenContent = tree.read('index.ts', 'utf-8');
      expect(writtenContent).toBe(initialContent);
    });

    it('should create file if it does not exist', () => {
      addStarExport(tree, 'index.ts', './module');

      const writtenContent = tree.read('index.ts', 'utf-8');
      expect(writtenContent).toContain('export * from "./module"');
    });
  });

  describe('replace', () => {
    it('should replace matching nodes', () => {
      const initialContent = `const x = 5;`;
      tree.write('file.ts', initialContent);

      replace(tree, 'file.ts', 'NumericLiteral', () =>
        factory.createNumericLiteral('10'),
      );

      const writtenContent = tree.read('file.ts', 'utf-8');
      expect(writtenContent).toContain('const x = 10');
    });

    it('should replace multiple matching nodes', () => {
      const initialContent = `const a = 1;
const b = 10000000;
const c = 99999;
const d = 0;
const e = 1;
const f = 9999;
`;
      tree.write('file.ts', initialContent);

      replace(tree, 'file.ts', 'NumericLiteral', () =>
        factory.createNumericLiteral('100'),
      );

      const writtenContent = tree.read('file.ts', 'utf-8');
      expect(writtenContent).toContain(`const a = 100;
const b = 100;
const c = 100;
const d = 100;
const e = 100;
const f = 100;
`);
    });

    it('should preserve new lines', () => {
      const initialContent = `const a = 1;
const b = 10000000;

const c = 99999;



const d = 0;
const e = 1;

const f = 9999;
`;
      tree.write('file.ts', initialContent);

      replace(tree, 'file.ts', 'NumericLiteral', () =>
        factory.createNumericLiteral('100'),
      );

      const writtenContent = tree.read('file.ts', 'utf-8');
      expect(writtenContent).toBe(`const a = 100;
const b = 100;

const c = 100;



const d = 100;
const e = 100;

const f = 100;
`);
    });

    it('should handle transformers which mutate the given node', () => {
      const initialContent = `const x = () => {};
const y = () => {};`;
      tree.write('file.ts', initialContent);

      replace(
        tree,
        'file.ts',
        'VariableDeclaration',
        (node: VariableDeclaration) => {
          const arrowFunction = node.initializer as ArrowFunction;
          const functionBody = arrowFunction.body as Block;

          // Create new arrow function with updated body
          const newArrowFunction = factory.createArrowFunction(
            arrowFunction.modifiers,
            arrowFunction.typeParameters,
            arrowFunction.parameters,
            arrowFunction.type,
            arrowFunction.equalsGreaterThanToken,
            factory.createBlock(
              [
                ...functionBody.statements,
                factory.createVariableStatement(undefined, [
                  factory.createVariableDeclaration(
                    'hello',
                    undefined,
                    undefined,
                    factory.createTrue(),
                  ),
                ]),
              ],
              true,
            ),
          );

          // Update the variable declaration
          return factory.createVariableDeclaration(
            node.name,
            node.exclamationToken,
            node.type,
            newArrowFunction,
          );
        },
      );

      const writtenContent = tree.read('file.ts', 'utf-8');
      expect(writtenContent).toBe(`const x = () => {
    var hello = true;
};
const y = () => {
    var hello = true;
};`);
    });

    it('should replace only the parent node where nested updates are applied', () => {
      const initialContent = `const x = () => {
  const y = () => {};
};
`;
      tree.write('file.ts', initialContent);

      replace(
        tree,
        'file.ts',
        'VariableDeclaration',
        (node: VariableDeclaration) => {
          const arrowFunction = node.initializer as ArrowFunction;
          const functionBody = arrowFunction.body as Block;

          // Create new arrow function with updated body
          const newArrowFunction = factory.createArrowFunction(
            arrowFunction.modifiers,
            arrowFunction.typeParameters,
            arrowFunction.parameters,
            arrowFunction.type,
            arrowFunction.equalsGreaterThanToken,
            factory.createBlock(
              [
                ...functionBody.statements,
                factory.createVariableStatement(undefined, [
                  factory.createVariableDeclaration(
                    'hello',
                    undefined,
                    undefined,
                    factory.createTrue(),
                  ),
                ]),
              ],
              true,
            ),
          );

          // Update the variable declaration
          return factory.createVariableDeclaration(
            node.name,
            node.exclamationToken,
            node.type,
            newArrowFunction,
          );
        },
      );

      const writtenContent = tree.read('file.ts', 'utf-8');
      expect(writtenContent).toBe(`const x = () => {
    const y = () => { };
    var hello = true;
};
`);
    });

    it('should handle nested replacements that return the node unchanged', () => {
      const initialContent = `const x = () => {
  const y = () => {};
};
`;
      tree.write('file.ts', initialContent);

      replace(tree, 'file.ts', 'VariableDeclaration', (node) => node);

      const writtenContent = tree.read('file.ts', 'utf-8');
      expect(writtenContent).toBe(initialContent);
    });

    it('should handle nested replacements where a child node is changed', () => {
      const initialContent = `const x = () => {
  const y = () => {
      const z = () => {
          const a = () => {

          };
      };
  };
};
`;
      tree.write('file.ts', initialContent);

      replace(
        tree,
        'file.ts',
        'VariableDeclaration',
        (node: VariableDeclaration) => {
          if (node.name.getText() !== 'z') {
            return node;
          }
          const arrowFunction = node.initializer as ArrowFunction;
          const functionBody = arrowFunction.body as Block;

          // Create new arrow function with updated body
          const newArrowFunction = factory.createArrowFunction(
            arrowFunction.modifiers,
            arrowFunction.typeParameters,
            arrowFunction.parameters,
            arrowFunction.type,
            arrowFunction.equalsGreaterThanToken,
            factory.createBlock(
              [
                ...functionBody.statements,
                factory.createVariableStatement(undefined, [
                  factory.createVariableDeclaration(
                    'hello',
                    undefined,
                    undefined,
                    factory.createTrue(),
                  ),
                ]),
              ],
              true,
            ),
          );

          // Update the variable declaration
          return factory.createVariableDeclaration(
            node.name,
            node.exclamationToken,
            node.type,
            newArrowFunction,
          );
        },
      );

      const writtenContent = tree.read('file.ts', 'utf-8');
      expect(writtenContent).toBe(`const x = () => {
  const y = () => {
      const z = () => {
    const a = () => {
    };
    var hello = true;
};
  };
};
`);
    });

    it('should throw if no matches found and errorIfNoMatches is true', () => {
      const initialContent = `const x = "string";`;
      tree.write('file.ts', initialContent);

      expect(() =>
        replace(tree, 'file.ts', 'NumericLiteral', () =>
          factory.createNumericLiteral('10'),
        ),
      ).toThrow();
    });

    it('should not throw if no matches found and errorIfNoMatches is false', () => {
      const initialContent = `const x = "string";`;
      tree.write('file.ts', initialContent);

      expect(() =>
        replace(
          tree,
          'file.ts',
          'NumericLiteral',
          () => factory.createNumericLiteral('10'),
          false,
        ),
      ).not.toThrow();

      expect(() =>
        replaceIfExists(tree, 'file.ts', 'NumericLiteral', () =>
          factory.createNumericLiteral('10'),
        ),
      ).not.toThrow();
    });

    it('should not mess up existing formatting', () => {
      const initialContent = `import {
  awsLambdaRequestHandler,
  CreateAWSLambdaContextOptions,
} from '@trpc/server/adapters/aws-lambda';
import { echo } from './procedures/echo.js';
import { t } from './init.js';
import { APIGatewayProxyEventV2WithIAMAuthorizer } from 'aws-lambda';

export const router = t.router;

export const appRouter = router({
  echo,
});

export const handler = awsLambdaRequestHandler({
  router: appRouter,
  createContext: (
    ctx: CreateAWSLambdaContextOptions<APIGatewayProxyEventV2WithIAMAuthorizer>,
  ) => ctx,
});

export type AppRouter = typeof appRouter;
`;
      tree.write('file.ts', initialContent);

      replace(
        tree,
        'file.ts',
        'CallExpression[expression.name="router"] > ObjectLiteralExpression',
        (node) =>
          factory.createObjectLiteralExpression([
            ...(node as ObjectLiteralExpression).properties,
            factory.createShorthandPropertyAssignment('foo'),
          ]),
      );

      const writtenContent = tree.read('file.ts', 'utf-8');
      expect(writtenContent).toContain(`import {
  awsLambdaRequestHandler,
  CreateAWSLambdaContextOptions,
} from '@trpc/server/adapters/aws-lambda';
import { echo } from './procedures/echo.js';
import { t } from './init.js';
import { APIGatewayProxyEventV2WithIAMAuthorizer } from 'aws-lambda';

export const router = t.router;

export const appRouter = router({ echo, foo });

export const handler = awsLambdaRequestHandler({
  router: appRouter,
  createContext: (
    ctx: CreateAWSLambdaContextOptions<APIGatewayProxyEventV2WithIAMAuthorizer>,
  ) => ctx,
});

export type AppRouter = typeof appRouter;
`);

      expect(writtenContent).toContain(`foo`);
    });

    it('should not duplicate comments', () => {
      const initialContent = `
// some comment
interface MyInterface {
    property: string;
}
`;
      tree.write('file.ts', initialContent);

      replace(
        tree,
        'file.ts',
        'InterfaceDeclaration',
        (node: InterfaceDeclaration) =>
          factory.createInterfaceDeclaration(
            node.modifiers,
            node.name,
            node.typeParameters,
            node.heritageClauses,
            [
              ...node.members,
              factory.createPropertySignature(
                undefined,
                'anotherProperty',
                undefined,
                factory.createKeywordTypeNode(SyntaxKind.NumberKeyword),
              ),
            ],
          ),
      );

      const writtenContent = tree.read('file.ts', 'utf-8');
      expect(writtenContent).toContain(`// some comment
interface MyInterface {
    property: string;
    anotherProperty: number;
}
`);
      expect(writtenContent.indexOf('some comment')).toEqual(
        writtenContent.lastIndexOf('some comment'),
      );
    });

    it('should not duplicate comments when replacing interface with preceding interface', () => {
      // This simulates what the file would look like with a prepended interface
      const contentWithPrependedInterface = `export interface FirstInterface {
    prop1: string;
    prop2: number;
}
// some comment
export interface MyInterface {
    property: string;
}`;

      tree.write('file.ts', contentWithPrependedInterface);

      replace(
        tree,
        'file.ts',
        'InterfaceDeclaration[name.text="MyInterface"]',
        (node: InterfaceDeclaration) => {
          return factory.createInterfaceDeclaration(
            node.modifiers,
            node.name,
            node.typeParameters,
            node.heritageClauses,
            [
              ...node.members,
              factory.createPropertySignature(
                undefined,
                factory.createIdentifier('anotherProperty'),
                undefined,
                factory.createKeywordTypeNode(SyntaxKind.NumberKeyword),
              ),
            ],
          );
        },
      );

      const writtenContent = tree.read('file.ts', 'utf-8');

      // Check that the comment appears only once
      expect(writtenContent.indexOf('some comment')).toEqual(
        writtenContent.lastIndexOf('some comment'),
      );

      // Verify the transformation worked
      expect(writtenContent).toContain('anotherProperty: number');
    });
  });

  describe('createJsxElementFromIdentifier', () => {
    it('should create JSX element with given identifier and children', () => {
      const element = createJsxElementFromIdentifier('div', [
        factory.createJsxText('Hello'),
      ]);

      expect((element.openingElement.tagName as any).text).toBe('div');
      expect(element.children[0].kind).toBe(
        factory.createJsxText('Hello').kind,
      );
    });
  });

  describe('createJsxElement', () => {
    it('should create JSX element from parts', () => {
      const opening = factory.createJsxOpeningElement(
        factory.createIdentifier('div'),
        undefined,
        factory.createJsxAttributes([]),
      );
      const closing = factory.createJsxClosingElement(
        factory.createIdentifier('div'),
      );
      const children = [factory.createJsxText('Hello')];

      const element = createJsxElement(opening, children, closing);

      expect(element.openingElement.tagName).toEqual(opening.tagName);
      expect(element.children[0].kind).toBe(children[0].kind);
      expect((element.children[0] as any).text).toBe('Hello');
      expect(element.closingElement.tagName).toEqual(closing.tagName);
    });
  });

  describe('jsonToAst', () => {
    it('should handle null', () => {
      expect(jsonToAst(null)).toEqual(factory.createNull());
    });

    it('should handle undefined', () => {
      expect(jsonToAst(undefined)).toEqual(
        factory.createIdentifier('undefined'),
      );
    });

    it('should handle strings', () => {
      expect(jsonToAst('test')).toEqual(factory.createStringLiteral('test'));
    });

    it('should handle numbers', () => {
      expect(jsonToAst(42)).toEqual(factory.createNumericLiteral(42));
    });

    it('should handle booleans', () => {
      expect(jsonToAst(true)).toEqual(factory.createTrue());
      expect(jsonToAst(false)).toEqual(factory.createFalse());
    });

    it('should handle arrays', () => {
      const input = [1, 'test', true];
      const expected = factory.createArrayLiteralExpression([
        factory.createNumericLiteral(1),
        factory.createStringLiteral('test'),
        factory.createTrue(),
      ]);
      expect(jsonToAst(input)).toEqual(expected);
    });

    it('should handle objects', () => {
      const input = {
        number: 42,
        string: 'test',
        boolean: true,
        nested: {
          array: [1, 2, 3],
        },
      };
      const expected = factory.createObjectLiteralExpression([
        factory.createPropertyAssignment(
          factory.createIdentifier('number'),
          factory.createNumericLiteral(42),
        ),
        factory.createPropertyAssignment(
          factory.createIdentifier('string'),
          factory.createStringLiteral('test'),
        ),
        factory.createPropertyAssignment(
          factory.createIdentifier('boolean'),
          factory.createTrue(),
        ),
        factory.createPropertyAssignment(
          factory.createIdentifier('nested'),
          factory.createObjectLiteralExpression([
            factory.createPropertyAssignment(
              factory.createIdentifier('array'),
              factory.createArrayLiteralExpression([
                factory.createNumericLiteral(1),
                factory.createNumericLiteral(2),
                factory.createNumericLiteral(3),
              ]),
            ),
          ]),
        ),
      ]);
      expect(jsonToAst(input)).toEqual(expected);
    });

    it('should handle objects with string keys', () => {
      const input = {
        'some/unsupported/syntax': 'test',
      };
      const expected = factory.createObjectLiteralExpression([
        factory.createPropertyAssignment(
          factory.createStringLiteral('some/unsupported/syntax'),
          factory.createStringLiteral('test'),
        ),
      ]);
      expect(jsonToAst(input)).toEqual(expected);
    });

    it('should throw error for unsupported types', () => {
      const fn = () => console.log('function!');
      expect(() => jsonToAst(fn)).toThrow('Unsupported type: function');
    });
  });

  describe('hasExportDeclaration', () => {
    it('should return true for exported type alias declarations', () => {
      const source = `export type MyType = string;`;
      expect(hasExportDeclaration(source, 'MyType')).toBe(true);
    });

    it('should return false for non-exported type alias declarations', () => {
      const source = `type MyType = string;`;
      expect(hasExportDeclaration(source, 'MyType')).toBe(false);
    });

    it('should return true for export declarations', () => {
      const source = `
        type MyType = string;
        export { MyType };
      `;
      expect(hasExportDeclaration(source, 'MyType')).toBe(true);
    });

    it('should return false when type alias does not exist', () => {
      const source = `type OtherType = string;`;
      expect(hasExportDeclaration(source, 'MyType')).toBe(false);
    });
  });

  describe('prependStatements', () => {
    it('should prepend statements to the beginning of a file', () => {
      const initialContent = `const existing = 'value';
console.log(existing);`;
      tree.write('file.ts', initialContent);

      const newStatement = factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList([
          factory.createVariableDeclaration(
            'prepended',
            undefined,
            undefined,
            factory.createStringLiteral('new value'),
          ),
        ]),
      );

      prependStatements(tree, 'file.ts', [newStatement]);

      const writtenContent = tree.read('file.ts', 'utf-8');
      expect(writtenContent).toContain('var prepended = "new value";');
      expect(writtenContent.indexOf('var prepended')).toBeLessThan(
        writtenContent.indexOf('const existing'),
      );
    });

    it('should prepend multiple statements in order', () => {
      const initialContent = `const existing = 'value';`;
      tree.write('file.ts', initialContent);

      const firstStatement = factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList([
          factory.createVariableDeclaration(
            'first',
            undefined,
            undefined,
            factory.createStringLiteral('first'),
          ),
        ]),
      );

      const secondStatement = factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList([
          factory.createVariableDeclaration(
            'second',
            undefined,
            undefined,
            factory.createStringLiteral('second'),
          ),
        ]),
      );

      prependStatements(tree, 'file.ts', [firstStatement, secondStatement]);

      const writtenContent = tree.read('file.ts', 'utf-8');
      expect(writtenContent.indexOf('var first')).toBeLessThan(
        writtenContent.indexOf('var second'),
      );
      expect(writtenContent.indexOf('var second')).toBeLessThan(
        writtenContent.indexOf('const existing'),
      );
    });

    it('should not duplicate comments when prepending statements', () => {
      const initialContent = `// some comment
interface MyInterface {
    property: string;
}`;
      tree.write('file.ts', initialContent);

      const newStatement = factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList([
          factory.createVariableDeclaration(
            'newVar',
            undefined,
            undefined,
            factory.createStringLiteral('value'),
          ),
        ]),
      );

      prependStatements(tree, 'file.ts', [newStatement]);

      const writtenContent = tree.read('file.ts', 'utf-8');

      // Check that the comment appears only once
      const commentMatches = writtenContent.match(/\/\/ some comment/g);
      expect(commentMatches).toHaveLength(1);

      // Check that the new statement is before the comment and interface
      expect(writtenContent.indexOf('var newVar')).toBeLessThan(
        writtenContent.indexOf('// some comment'),
      );
      expect(writtenContent.indexOf('// some comment')).toBeLessThan(
        writtenContent.indexOf('interface MyInterface'),
      );
    });

    it('should handle empty file', () => {
      tree.write('empty.ts', '');

      const newStatement = factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList([
          factory.createVariableDeclaration(
            'newVar',
            undefined,
            undefined,
            factory.createStringLiteral('value'),
          ),
        ]),
      );

      prependStatements(tree, 'empty.ts', [newStatement]);

      const writtenContent = tree.read('empty.ts', 'utf-8');
      expect(writtenContent).toContain('var newVar = "value";');
    });

    it('should throw if file does not exist', () => {
      const newStatement = factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList([
          factory.createVariableDeclaration(
            'newVar',
            undefined,
            undefined,
            factory.createStringLiteral('value'),
          ),
        ]),
      );

      expect(() =>
        prependStatements(tree, 'nonexistent.ts', [newStatement]),
      ).toThrow('No file located at nonexistent.ts');
    });
  });

  describe('appendStatements', () => {
    it('should append statements to the end of a file', () => {
      const initialContent = `const existing = 'value';
console.log(existing);`;
      tree.write('file.ts', initialContent);

      const newStatement = factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList([
          factory.createVariableDeclaration(
            'appended',
            undefined,
            undefined,
            factory.createStringLiteral('new value'),
          ),
        ]),
      );

      appendStatements(tree, 'file.ts', [newStatement]);

      const writtenContent = tree.read('file.ts', 'utf-8');
      expect(writtenContent).toContain('var appended = "new value";');
      expect(writtenContent.indexOf('const existing')).toBeLessThan(
        writtenContent.indexOf('var appended'),
      );
    });

    it('should append multiple statements in order', () => {
      const initialContent = `const existing = 'value';`;
      tree.write('file.ts', initialContent);

      const firstStatement = factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList([
          factory.createVariableDeclaration(
            'first',
            undefined,
            undefined,
            factory.createStringLiteral('first'),
          ),
        ]),
      );

      const secondStatement = factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList([
          factory.createVariableDeclaration(
            'second',
            undefined,
            undefined,
            factory.createStringLiteral('second'),
          ),
        ]),
      );

      appendStatements(tree, 'file.ts', [firstStatement, secondStatement]);

      const writtenContent = tree.read('file.ts', 'utf-8');
      expect(writtenContent.indexOf('const existing')).toBeLessThan(
        writtenContent.indexOf('var first'),
      );
      expect(writtenContent.indexOf('var first')).toBeLessThan(
        writtenContent.indexOf('var second'),
      );
    });

    it('should preserve existing comments when appending statements', () => {
      const initialContent = `// some comment
interface MyInterface {
    property: string;
}`;
      tree.write('file.ts', initialContent);

      const newStatement = factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList([
          factory.createVariableDeclaration(
            'newVar',
            undefined,
            undefined,
            factory.createStringLiteral('value'),
          ),
        ]),
      );

      appendStatements(tree, 'file.ts', [newStatement]);

      const writtenContent = tree.read('file.ts', 'utf-8');

      // Check that the comment appears only once
      const commentMatches = writtenContent.match(/\/\/ some comment/g);
      expect(commentMatches).toHaveLength(1);

      // Check that the new statement is after the interface
      expect(writtenContent.indexOf('// some comment')).toBeLessThan(
        writtenContent.indexOf('interface MyInterface'),
      );
      expect(writtenContent.indexOf('interface MyInterface')).toBeLessThan(
        writtenContent.indexOf('var newVar'),
      );
    });

    it('should handle empty file', () => {
      tree.write('empty.ts', '');

      const newStatement = factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList([
          factory.createVariableDeclaration(
            'newVar',
            undefined,
            undefined,
            factory.createStringLiteral('value'),
          ),
        ]),
      );

      appendStatements(tree, 'empty.ts', [newStatement]);

      const writtenContent = tree.read('empty.ts', 'utf-8');
      expect(writtenContent).toContain('var newVar = "value";');
    });

    it('should throw if file does not exist', () => {
      const newStatement = factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList([
          factory.createVariableDeclaration(
            'newVar',
            undefined,
            undefined,
            factory.createStringLiteral('value'),
          ),
        ]),
      );

      expect(() =>
        appendStatements(tree, 'nonexistent.ts', [newStatement]),
      ).toThrow('No file located at nonexistent.ts');
    });
  });
});
