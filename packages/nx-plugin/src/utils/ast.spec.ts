/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { Tree } from '@nx/devkit';
import { factory } from 'typescript';
import {
  destructuredImport,
  singleImport,
  addStarExport,
  replace,
  createJsxElementFromIdentifier,
  createJsxElement,
  jsonToAst,
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

      destructuredImport(
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

      destructuredImport(
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

      destructuredImport(
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
        destructuredImport(
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

      singleImport(mockTree, 'file.ts', 'DefaultImport', '@scope/package');

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

      singleImport(mockTree, 'file.ts', 'DefaultImport', '@scope/package');

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
});
