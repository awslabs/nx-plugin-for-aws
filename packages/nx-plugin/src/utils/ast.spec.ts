/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { Tree } from '@nx/devkit';
import {
  ArrowFunction,
  Block,
  factory,
  FunctionDeclaration,
  NumericLiteral,
  ObjectLiteralExpression,
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
} from './ast';

describe('ast utils', () => {
  let mockTree: Tree;

  beforeEach(() => {
    mockTree = {
      exists: vi.fn(),
      read: vi.fn(),
      write: vi.fn(),
    } as unknown as Tree;
  });

  describe('destructuredImport', () => {
    it('should add new named imports', () => {
      const initialContent = `import { existingImport } from '@scope/package';`;
      vi.mocked(mockTree.exists).mockReturnValue(true);
      vi.mocked(mockTree.read).mockReturnValue(initialContent);

      addDestructuredImport(
        mockTree,
        'file.ts',
        ['newImport1', 'newImport2'],
        '@scope/package',
      );

      expect(mockTree.write).toHaveBeenCalledWith(
        'file.ts',
        expect.any(String),
      );
      const writtenContent = vi.mocked(mockTree.write).mock.calls[0][1];
      expect(writtenContent).toMatch(
        /import\s*{\s*existingImport,\s*newImport1,\s*newImport2\s*}\s*from\s*["']@scope\/package["']/,
      );
    });

    it('should handle aliased imports', () => {
      const initialContent = `import { existing } from '@scope/package';`;
      vi.mocked(mockTree.exists).mockReturnValue(true);
      vi.mocked(mockTree.read).mockReturnValue(initialContent);

      addDestructuredImport(
        mockTree,
        'file.ts',
        ['original as alias'],
        '@scope/package',
      );

      expect(mockTree.write).toHaveBeenCalledWith(
        'file.ts',
        expect.any(String),
      );
      const writtenContent = vi.mocked(mockTree.write).mock.calls[0][1];
      expect(writtenContent).toMatch(
        /import\s*{\s*existing,\s*original\s+as\s+alias\s*}\s*from\s*["']@scope\/package["']/,
      );
    });

    it('should not duplicate existing imports', () => {
      const initialContent = `import { existingImport } from '@scope/package';`;
      vi.mocked(mockTree.exists).mockReturnValue(true);
      vi.mocked(mockTree.read).mockReturnValue(initialContent);

      addDestructuredImport(
        mockTree,
        'file.ts',
        ['existingImport'],
        '@scope/package',
      );

      expect(mockTree.write).not.toHaveBeenCalled();
    });

    it('should throw if file does not exist', () => {
      vi.mocked(mockTree.exists).mockReturnValue(false);

      expect(() =>
        addDestructuredImport(
          mockTree,
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
      vi.mocked(mockTree.exists).mockReturnValue(true);
      vi.mocked(mockTree.read).mockReturnValue(initialContent);

      addSingleImport(mockTree, 'file.ts', 'DefaultImport', '@scope/package');

      expect(mockTree.write).toHaveBeenCalledWith(
        'file.ts',
        expect.any(String),
      );
      const writtenContent = vi.mocked(mockTree.write).mock.calls[0][1];
      expect(writtenContent).toMatch(
        /import\s+DefaultImport\s+from\s*["']@scope\/package["']/,
      );
    });

    it('should not duplicate existing default import', () => {
      const initialContent = `import DefaultImport from '@scope/package';`;
      vi.mocked(mockTree.exists).mockReturnValue(true);
      vi.mocked(mockTree.read).mockReturnValue(initialContent);

      addSingleImport(mockTree, 'file.ts', 'DefaultImport', '@scope/package');

      expect(mockTree.write).not.toHaveBeenCalled();
    });
  });

  describe('addStarExport', () => {
    it('should add star export if none exists', () => {
      const initialContent = `// Some content`;
      vi.mocked(mockTree.exists).mockReturnValue(true);
      vi.mocked(mockTree.read).mockReturnValue(initialContent);

      addStarExport(mockTree, 'index.ts', './module');

      expect(mockTree.write).toHaveBeenCalledWith(
        'index.ts',
        expect.stringContaining('export * from "./module"'),
      );
    });

    it('should not duplicate existing star export', () => {
      const initialContent = `export * from './module';`;
      vi.mocked(mockTree.exists).mockReturnValue(true);
      vi.mocked(mockTree.read).mockReturnValue(initialContent);

      addStarExport(mockTree, 'index.ts', './module');

      expect(mockTree.write).not.toHaveBeenCalled();
    });

    it('should create file if it does not exist', () => {
      vi.mocked(mockTree.exists).mockReturnValue(false);
      vi.mocked(mockTree.read).mockReturnValue('');

      addStarExport(mockTree, 'index.ts', './module');

      expect(mockTree.write).toHaveBeenCalledWith(
        'index.ts',
        expect.stringContaining('export * from "./module"'),
      );
    });
  });

  describe('replace', () => {
    it('should replace matching nodes', () => {
      const initialContent = `const x = 5;`;
      vi.mocked(mockTree.exists).mockReturnValue(true);
      vi.mocked(mockTree.read).mockReturnValue(initialContent);

      replace(mockTree, 'file.ts', 'NumericLiteral', () =>
        factory.createNumericLiteral('10'),
      );

      expect(mockTree.write).toHaveBeenCalledWith(
        'file.ts',
        expect.stringContaining('const x = 10'),
      );
    });

    it('should replace multiple matching nodes', () => {
      const initialContent = `const a = 1;
const b = 10000000;
const c = 99999;
const d = 0;
const e = 1;
const f = 9999;
`;
      vi.mocked(mockTree.exists).mockReturnValue(true);
      vi.mocked(mockTree.read).mockReturnValue(initialContent);

      replace(mockTree, 'file.ts', 'NumericLiteral', () =>
        factory.createNumericLiteral('100'),
      );

      expect(mockTree.write).toHaveBeenCalledWith(
        'file.ts',
        expect.stringContaining(`const a = 100;
const b = 100;
const c = 100;
const d = 100;
const e = 100;
const f = 100;
`),
      );
    });

    it('should preserve new lines', () => {
      const initialContent = `const a = 1;
const b = 10000000;

const c = 99999;



const d = 0;
const e = 1;

const f = 9999;
`;
      vi.mocked(mockTree.exists).mockReturnValue(true);
      vi.mocked(mockTree.read).mockReturnValue(initialContent);

      replace(mockTree, 'file.ts', 'NumericLiteral', () =>
        factory.createNumericLiteral('100'),
      );

      expect(mockTree.write).toHaveBeenCalledWith(
        'file.ts',
        `const a = 100;
const b = 100;

const c = 100;



const d = 100;
const e = 100;

const f = 100;
`,
      );
    });

    it('should handle transformers which mutate the given node', () => {
      const initialContent = `const x = () => {};
const y = () => {};`;
      vi.mocked(mockTree.exists).mockReturnValue(true);
      vi.mocked(mockTree.read).mockReturnValue(initialContent);

      replace(
        mockTree,
        'file.ts',
        'VariableDeclaration',
        (node: VariableDeclaration) => {
          const arrowFunction = node.initializer as ArrowFunction;
          const functionBody = arrowFunction.body as Block;

          // Create new arrow function with updated body
          const newArrowFunction = factory.updateArrowFunction(
            arrowFunction,
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
          return factory.updateVariableDeclaration(
            node,
            node.name,
            node.exclamationToken,
            node.type,
            newArrowFunction,
          );
        },
      );

      expect(mockTree.write).toHaveBeenCalledWith(
        'file.ts',
        `const x = () => {
    var hello = true;
};
const y = () => {
    var hello = true;
};`,
      );
    });

    it('should replace only the parent node where nested updates are applied', () => {
      const initialContent = `const x = () => {
  const y = () => {};
};
`;
      vi.mocked(mockTree.exists).mockReturnValue(true);
      vi.mocked(mockTree.read).mockReturnValue(initialContent);

      replace(
        mockTree,
        'file.ts',
        'VariableDeclaration',
        (node: VariableDeclaration) => {
          const arrowFunction = node.initializer as ArrowFunction;
          const functionBody = arrowFunction.body as Block;

          // Create new arrow function with updated body
          const newArrowFunction = factory.updateArrowFunction(
            arrowFunction,
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
          return factory.updateVariableDeclaration(
            node,
            node.name,
            node.exclamationToken,
            node.type,
            newArrowFunction,
          );
        },
      );

      expect(mockTree.write).toHaveBeenCalledWith(
        'file.ts',
        `const x = () => {
    const y = () => { };
    var hello = true;
};
`,
      );
    });

    it('should handle nested replacements that return the node unchanged', () => {
      const initialContent = `const x = () => {
  const y = () => {};
};
`;
      vi.mocked(mockTree.exists).mockReturnValue(true);
      vi.mocked(mockTree.read).mockReturnValue(initialContent);

      replace(mockTree, 'file.ts', 'VariableDeclaration', (node) => node);

      // No changes should have been made
      expect(mockTree.write).not.toHaveBeenCalled();
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
      vi.mocked(mockTree.exists).mockReturnValue(true);
      vi.mocked(mockTree.read).mockReturnValue(initialContent);

      replace(
        mockTree,
        'file.ts',
        'VariableDeclaration',
        (node: VariableDeclaration) => {
          if (node.name.getText() !== 'z') {
            return node;
          }
          const arrowFunction = node.initializer as ArrowFunction;
          const functionBody = arrowFunction.body as Block;

          // Create new arrow function with updated body
          const newArrowFunction = factory.updateArrowFunction(
            arrowFunction,
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
          return factory.updateVariableDeclaration(
            node,
            node.name,
            node.exclamationToken,
            node.type,
            newArrowFunction,
          );
        },
      );

      expect(mockTree.write).toHaveBeenCalledWith(
        'file.ts',
        `const x = () => {
  const y = () => {
      const z = () => {
    const a = () => {
    };
    var hello = true;
};
  };
};
`,
      );
    });

    it('should throw if no matches found and errorIfNoMatches is true', () => {
      const initialContent = `const x = "string";`;
      vi.mocked(mockTree.exists).mockReturnValue(true);
      vi.mocked(mockTree.read).mockReturnValue(initialContent);

      expect(() =>
        replace(mockTree, 'file.ts', 'NumericLiteral', () =>
          factory.createNumericLiteral('10'),
        ),
      ).toThrow();
    });

    it('should not throw if no matches found and errorIfNoMatches is false', () => {
      const initialContent = `const x = "string";`;
      vi.mocked(mockTree.exists).mockReturnValue(true);
      vi.mocked(mockTree.read).mockReturnValue(initialContent);

      expect(() =>
        replace(
          mockTree,
          'file.ts',
          'NumericLiteral',
          () => factory.createNumericLiteral('10'),
          false,
        ),
      ).not.toThrow();

      expect(() =>
        replaceIfExists(mockTree, 'file.ts', 'NumericLiteral', () =>
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
      vi.mocked(mockTree.exists).mockReturnValue(true);
      vi.mocked(mockTree.read).mockReturnValue(initialContent);

      replace(
        mockTree,
        'file.ts',
        'CallExpression[expression.name="router"] > ObjectLiteralExpression',
        (node) =>
          factory.createObjectLiteralExpression([
            ...(node as ObjectLiteralExpression).properties,
            factory.createShorthandPropertyAssignment('foo'),
          ]),
      );

      expect(mockTree.write).toHaveBeenCalledWith(
        'file.ts',
        expect.stringContaining(`import {
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
`),
      );

      expect(mockTree.write).toHaveBeenCalledWith(
        'file.ts',
        expect.stringContaining(`foo`),
      );
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
});
