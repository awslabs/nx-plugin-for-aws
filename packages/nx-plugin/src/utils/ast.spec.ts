/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import {
  addDestructuredImport,
  addSingleImport,
  addStarExport,
  hasExportDeclaration,
  applyGritQL,
  matchGritQL,
} from './ast';

describe('ast utils', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  describe('destructuredImport', () => {
    it('should add new named imports', async () => {
      const initialContent = `import { existingImport } from '@scope/package';`;
      tree.write('file.ts', initialContent);

      await addDestructuredImport(
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

    it('should handle aliased imports', async () => {
      const initialContent = `import { existing } from '@scope/package';`;
      tree.write('file.ts', initialContent);

      await addDestructuredImport(
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

    it('should not duplicate existing imports', async () => {
      const initialContent = `import { existingImport } from '@scope/package';`;
      tree.write('file.ts', initialContent);

      await addDestructuredImport(
        tree,
        'file.ts',
        ['existingImport'],
        '@scope/package',
      );

      const writtenContent = tree.read('file.ts', 'utf-8');
      expect(writtenContent).toBe(initialContent);
    });

    it('should merge imports when called twice with different variables from same module', async () => {
      const initialContent = `import { Agent } from '@strands-agents/sdk';`;
      tree.write('file.ts', initialContent);

      await addDestructuredImport(
        tree,
        'file.ts',
        ['ClientA'],
        ':scope/agent-connection',
      );
      await addDestructuredImport(
        tree,
        'file.ts',
        ['ClientB'],
        ':scope/agent-connection',
      );

      const writtenContent = tree.read('file.ts', 'utf-8')!;

      // Should have exactly one import from agent-connection
      const importLines = writtenContent
        .split('\n')
        .filter((l) => l.includes('agent-connection'));
      expect(importLines).toHaveLength(1);

      // The single import should contain both clients
      expect(importLines[0]).toContain('ClientA');
      expect(importLines[0]).toContain('ClientB');
    });

    it('should throw if file does not exist', async () => {
      await expect(
        addDestructuredImport(
          tree,
          'nonexistent.ts',
          ['import1'],
          '@scope/package',
        ),
      ).rejects.toThrow('No file located at nonexistent.ts');
    });
  });

  describe('singleImport', () => {
    it('should add new default import', async () => {
      const initialContent = `// Some content`;
      tree.write('file.ts', initialContent);

      await addSingleImport(tree, 'file.ts', 'DefaultImport', '@scope/package');

      const writtenContent = tree.read('file.ts', 'utf-8');
      expect(writtenContent).toMatch(
        /import\s+DefaultImport\s+from\s*["']@scope\/package["']/,
      );
    });

    it('should not duplicate existing default import', async () => {
      const initialContent = `import DefaultImport from '@scope/package';`;
      tree.write('file.ts', initialContent);

      await addSingleImport(tree, 'file.ts', 'DefaultImport', '@scope/package');

      const writtenContent = tree.read('file.ts', 'utf-8');
      expect(writtenContent).toBe(initialContent);
    });
  });

  describe('addStarExport', () => {
    it('should add star export if none exists', async () => {
      const initialContent = `// Some content`;
      tree.write('index.ts', initialContent);

      await addStarExport(tree, 'index.ts', './module');

      const writtenContent = tree.read('index.ts', 'utf-8');
      expect(writtenContent).toContain('export * from "./module"');
    });

    it('should not duplicate existing star export', async () => {
      const initialContent = `export * from './module';`;
      tree.write('index.ts', initialContent);

      await addStarExport(tree, 'index.ts', './module');

      const writtenContent = tree.read('index.ts', 'utf-8');
      expect(writtenContent).toBe(initialContent);
    });

    it('should create file if it does not exist', async () => {
      await addStarExport(tree, 'index.ts', './module');

      const writtenContent = tree.read('index.ts', 'utf-8');
      expect(writtenContent).toContain('export * from "./module"');
    });
  });

  describe('hasExportDeclaration', () => {
    it('should return true for exported type alias declarations', async () => {
      const source = `export type MyType = string;`;
      expect(await hasExportDeclaration(source, 'MyType')).toBe(true);
    });

    it('should return false for non-exported type alias declarations', async () => {
      const source = `type MyType = string;`;
      expect(await hasExportDeclaration(source, 'MyType')).toBe(false);
    });

    it('should return true for export declarations', async () => {
      const source = `
        type MyType = string;
        export { MyType };
      `;
      expect(await hasExportDeclaration(source, 'MyType')).toBe(true);
    });

    it('should return false when type alias does not exist', async () => {
      const source = `type OtherType = string;`;
      expect(await hasExportDeclaration(source, 'MyType')).toBe(false);
    });

    it('should return true for re-exported types', async () => {
      const source = `export type { AppRouter } from "./router";`;
      expect(await hasExportDeclaration(source, 'AppRouter')).toBe(true);
    });
  });

  describe('applyGritQL', () => {
    it('should apply a simple rewrite pattern', async () => {
      tree.write('file.ts', `const x = 5;`);

      const changed = await applyGritQL(
        tree,
        'file.ts',
        '`const x = $val` => `const x = 10`',
      );

      expect(changed).toBe(true);
      expect(tree.read('file.ts', 'utf-8')).toContain('const x = 10');
    });

    it('should return false when pattern does not match', async () => {
      tree.write('file.ts', `const x = 5;`);

      const changed = await applyGritQL(
        tree,
        'file.ts',
        '`const y = $val` => `const y = 10`',
      );

      expect(changed).toBe(false);
      expect(tree.read('file.ts', 'utf-8')).toBe('const x = 5;');
    });

    it('should throw when file does not exist', async () => {
      await expect(
        applyGritQL(
          tree,
          'nonexistent.ts',
          '`const x = $val` => `const x = 10`',
        ),
      ).rejects.toThrow('No file at nonexistent.ts');
    });

    it('should support where clause with not contains for idempotency', async () => {
      tree.write('file.ts', `const tags = ['a'];`);

      // First call adds 'b' using += (accumulate) with comma prefix
      await applyGritQL(
        tree,
        'file.ts',
        "`const tags = [$items]` where { $items += `, 'b'` } where { $program <: not contains `'b'` }",
      );
      expect(tree.read('file.ts', 'utf-8')).toContain("'a', 'b'");

      // Second call should be idempotent
      await applyGritQL(
        tree,
        'file.ts',
        "`const tags = [$items]` where { $items += `, 'b'` } where { $program <: not contains `'b'` }",
      );
      expect(tree.read('file.ts', 'utf-8')).not.toContain("'b', 'b'");
    });

    it('should support within clause for scoped matching', async () => {
      tree.write(
        'file.ts',
        `const id = 'outer';
class MyClass implements SomeInterface {
  method(): void {
    const id = 'inner';
  }
}`,
      );

      await applyGritQL(
        tree,
        'file.ts',
        "`const id = $old` => `const id = 'replaced'` where { $old <: within `class MyClass implements $_ { $_ }` }",
      );

      const content = tree.read('file.ts', 'utf-8')!;
      expect(content).toContain("const id = 'outer'");
      expect(content).toContain("const id = 'replaced'");
    });

    it('should support if/else for empty vs non-empty arrays', async () => {
      tree.write(
        'file.ts',
        `class Foo implements Bar {
  visit(): void {
    const tags: string[] = [];
  }
}`,
      );

      const WITHIN = '$old <: within `class Foo implements $_ { $_ }`';

      // Add first tag to empty array
      await applyGritQL(
        tree,
        'file.ts',
        '`const tags: string[] = $old`' +
          ` where { ${WITHIN},` +
          " if ($old <: `[]`) { $old => `['a']` }" +
          " else { $old <: `[$items]` where { $items += `, 'a'` } }," +
          " $old <: not contains `'a'` }",
      );
      expect(tree.read('file.ts', 'utf-8')).toContain("['a']");

      // Add second tag to non-empty array
      await applyGritQL(
        tree,
        'file.ts',
        '`const tags: string[] = $old`' +
          ` where { ${WITHIN},` +
          " if ($old <: `[]`) { $old => `['b']` }" +
          " else { $old <: `[$items]` where { $items += `, 'b'` } }," +
          " $old <: not contains `'b'` }",
      );
      expect(tree.read('file.ts', 'utf-8')).toContain("['a', 'b']");
    });

    it('should append to multi-line arrays without double commas', async () => {
      tree.write(
        'file.ts',
        `const tags = [
  'a',
  'b',
  'c',
];`,
      );

      // Append to multi-line array using += (accumulate) with comma prefix
      await applyGritQL(
        tree,
        'file.ts',
        "`const tags = [$items]` where { $items += `, 'd'` } where { $program <: not contains `'d'` }",
      );

      const content = tree.read('file.ts', 'utf-8')!;
      expect(content).not.toContain(',,');
      expect(content).toContain("'d'");
      expect(content).toContain("'a'");
      expect(content).toContain("'b'");
      expect(content).toContain("'c'");
    });

    it('should append to multi-line arrays with scoped matching', async () => {
      tree.write(
        'file.ts',
        `class MetricsAspect implements IAspect {
  visit(): void {
    const tags: string[] = [
      'g1',
      'g2',
      'g3',
    ];
  }
}`,
      );

      const WITHIN =
        '$old <: within `class MetricsAspect implements $_ { $_ }`';

      await applyGritQL(
        tree,
        'file.ts',
        '`const tags: string[] = $old`' +
          ` where { ${WITHIN},` +
          " if ($old <: `[]`) { $old => `['g4']` }" +
          " else { $old <: `[$items]` where { $items += `, 'g4'` } }," +
          " $old <: not contains `'g4'` }",
      );

      const content = tree.read('file.ts', 'utf-8')!;
      expect(content).not.toContain(',,');
      expect(content).toContain("'g4'");
      expect(content).toContain("'g1'");
      expect(content).toContain("'g2'");
      expect(content).toContain("'g3'");
    });

    it('should work with HCL (.tf) files', async () => {
      tree.write(
        'main.tf',
        `locals {
  name = "old"
}`,
      );

      await applyGritQL(tree, 'main.tf', '`name = $old` => `name = "new"`');

      expect(tree.read('main.tf', 'utf-8')).toContain('name = "new"');
    });

    it('should support or{} pattern for HCL arrays', async () => {
      tree.write(
        'main.tf',
        `locals {
  tags = []
}`,
      );

      // Add first tag
      await applyGritQL(
        tree,
        'main.tf',
        'or { `tags = []` => `tags = ["t1"]`, `tags = [$items]` where { $items += `, "t1"` } where { $items <: not contains `"t1"` } }',
      );
      expect(tree.read('main.tf', 'utf-8')).toContain('["t1"]');

      // Add second tag
      await applyGritQL(
        tree,
        'main.tf',
        'or { `tags = []` => `tags = ["t2"]`, `tags = [$items]` where { $items += `, "t2"` } where { $items <: not contains `"t2"` } }',
      );
      expect(tree.read('main.tf', 'utf-8')).toContain('"t1"');
      expect(tree.read('main.tf', 'utf-8')).toContain('"t2"');

      // Idempotency
      await applyGritQL(
        tree,
        'main.tf',
        'or { `tags = []` => `tags = ["t1"]`, `tags = [$items]` where { $items += `, "t1"` } where { $items <: not contains `"t1"` } }',
      );
      expect(tree.read('main.tf', 'utf-8')).not.toContain('"t1", "t2", "t1"');
    });

    it('should append to multi-line HCL arrays without double commas', async () => {
      tree.write(
        'main.tf',
        `locals {
  tags = [
    "t1",
    "t2",
    "t3",
  ]
}`,
      );

      await applyGritQL(
        tree,
        'main.tf',
        'or { `tags = []` => `tags = ["t4"]`, `tags = [$items]` where { $items += `, "t4"` } where { $items <: not contains `"t4"` } }',
      );

      const content = tree.read('main.tf', 'utf-8')!;
      expect(content).not.toContain(',,');
      expect(content).toContain('"t4"');
      expect(content).toContain('"t1"');
      expect(content).toContain('"t2"');
      expect(content).toContain('"t3"');
    });
  });

  describe('matchGritQL', () => {
    it('should return true when pattern matches', async () => {
      tree.write('file.ts', `const x = 5;`);

      const result = await matchGritQL(tree, 'file.ts', '`const x = $val`');
      expect(result).toBe(true);
    });

    it('should return false when pattern does not match', async () => {
      tree.write('file.ts', `const x = 5;`);

      const result = await matchGritQL(tree, 'file.ts', '`const y = $val`');
      expect(result).toBe(false);
    });

    it('should return false when file does not exist', async () => {
      const result = await matchGritQL(
        tree,
        'nonexistent.ts',
        '`const x = $val`',
      );
      expect(result).toBe(false);
    });

    it('should match structural patterns', async () => {
      tree.write(
        'file.ts',
        `class MyClass implements SomeInterface {
  method(): void {}
}`,
      );

      expect(await matchGritQL(tree, 'file.ts', '`MyClass`')).toBe(true);
      expect(await matchGritQL(tree, 'file.ts', '`SomeInterface`')).toBe(true);
      expect(await matchGritQL(tree, 'file.ts', '`OtherClass`')).toBe(false);
    });
  });
});
