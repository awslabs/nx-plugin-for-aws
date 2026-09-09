/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addDestructuredImport,
  addNamedExport,
  addPythonDestructuredImport,
  addSingleImport,
  addStarExport,
  appendToArrayViaGritQL,
  applyGritQL,
  captureAllGritQLVariable,
  hasExportDeclaration,
  matchGritQL,
} from './ast.js';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from './config/utils.js';

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
        '@scope/agent-connection',
      );
      await addDestructuredImport(
        tree,
        'file.ts',
        ['ClientB'],
        '@scope/agent-connection',
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

    it('should refuse to bind the same identifier to a second module', async () => {
      const initialContent = `import DefaultImport from '@scope/package';`;
      tree.write('file.ts', initialContent);

      await expect(
        addSingleImport(tree, 'file.ts', 'DefaultImport', '@scope/other'),
      ).rejects.toThrow(/already imported from a different module/);

      expect(tree.read('file.ts', 'utf-8')).toBe(initialContent);
    });
  });

  // Every helper that writes a new statement to the top of a file must land
  // below the shebang and leading comment, so a license header stays first.
  describe('inserting below leading comments', () => {
    const header = `/**\n * Copyright Test Inc.\n */`;

    it('addDestructuredImport should insert below a leading block comment', async () => {
      tree.write('file.ts', `${header}\nconst x = 1;\n`);

      await addDestructuredImport(tree, 'file.ts', ['foo'], '@scope/pkg');

      expect(tree.read('file.ts', 'utf-8')).toBe(
        `${header}\nimport { foo } from '@scope/pkg';\nconst x = 1;\n`,
      );
    });

    it('addSingleImport should insert below a leading block comment', async () => {
      tree.write('file.ts', `${header}\nconst x = 1;\n`);

      await addSingleImport(tree, 'file.ts', 'foo', '@scope/pkg');

      expect(tree.read('file.ts', 'utf-8')).toBe(
        `${header}\nimport foo from '@scope/pkg';\nconst x = 1;\n`,
      );
    });

    it('addNamedExport should insert below a leading block comment', async () => {
      tree.write('index.ts', `${header}\nconst x = 1;\n`);

      await addNamedExport(tree, 'index.ts', ['createFoo'], './foo');

      expect(tree.read('index.ts', 'utf-8')).toBe(
        `${header}\nexport { createFoo } from './foo';\nconst x = 1;\n`,
      );
    });

    it('addPythonDestructuredImport should insert below a leading comment', async () => {
      // Python comments are `#`, so the block is only found via the syntax
      // resolved for the `py` extension.
      const pyHeader = `# Copyright Test Inc.`;
      tree.write('mod.py', `${pyHeader}\nx = 1\n`);

      await addPythonDestructuredImport(tree, 'mod.py', ['foo'], 'pkg');

      expect(tree.read('mod.py', 'utf-8')).toBe(
        `${pyHeader}\nfrom pkg import foo\nx = 1\n`,
      );
    });

    it('should insert below a hashbang and leading comment', async () => {
      tree.write('cli.ts', `#!/usr/bin/env node\n${header}\nconst x = 1;\n`);

      await addSingleImport(tree, 'cli.ts', 'foo', '@scope/pkg');

      expect(tree.read('cli.ts', 'utf-8')).toBe(
        `#!/usr/bin/env node\n${header}\nimport foo from '@scope/pkg';\nconst x = 1;\n`,
      );
    });
  });

  describe('addStarExport', () => {
    it('should add star export if none exists', async () => {
      const initialContent = `// Some content`;
      tree.write('index.ts', initialContent);

      await addStarExport(tree, 'index.ts', './module');

      const writtenContent = tree.read('index.ts', 'utf-8');
      expect(writtenContent).toContain("export * from './module'");
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
      expect(writtenContent).toContain("export * from './module'");
    });

    // license#sync writes the header as the file's leading comment; an export
    // inserted above it would leave the header stranded, so the next sync adds
    // a second one.
    it('should add the export below a leading block comment', async () => {
      const header = `/**\n * Copyright Test Inc.\n */`;
      tree.write('index.ts', `${header}\nexport const x = 1;\n`);

      await addStarExport(tree, 'index.ts', './module');

      expect(tree.read('index.ts', 'utf-8')).toBe(
        `${header}\nexport * from './module';\nexport const x = 1;\n`,
      );
    });

    it('should add the export below a leading run of line comments', async () => {
      const header = `// Copyright Test Inc.\n// All rights reserved`;
      tree.write('index.ts', `${header}\nexport const x = 1;\n`);

      await addStarExport(tree, 'index.ts', './module');

      expect(tree.read('index.ts', 'utf-8')).toBe(
        `${header}\nexport * from './module';\nexport const x = 1;\n`,
      );
    });

    it('should add the export below a hashbang and leading comment', async () => {
      const header = `#!/usr/bin/env node\n/**\n * Copyright Test Inc.\n */`;
      tree.write('index.ts', `${header}\nexport const x = 1;\n`);

      await addStarExport(tree, 'index.ts', './module');

      expect(tree.read('index.ts', 'utf-8')).toBe(
        `${header}\nexport * from './module';\nexport const x = 1;\n`,
      );
    });

    it('should still insert below the comment when the config fails to load', async () => {
      // Reading the config evaluates it. An unreadable config must not stop the
      // import being added — the default syntax for the extension is used.
      tree.write(
        'aws-nx-plugin.config.mts',
        `import { missing } from './does-not-exist.js';\nexport default missing;\n`,
      );
      const header = `/**\n * Copyright Test Inc.\n */`;
      tree.write('index.ts', `${header}\nexport const x = 1;\n`);

      await addStarExport(tree, 'index.ts', './module');

      expect(tree.read('index.ts', 'utf-8')).toBe(
        `${header}\nexport * from './module';\nexport const x = 1;\n`,
      );
    });

    it('should use commentSyntax from config for an extension the defaults do not cover', async () => {
      // `xyz` is absent from LANGUAGE_COMMENT_SYNTAX, so without the config read
      // the comment block would not be found and the export would go above it.
      await ensureAwsNxPluginConfig(tree);
      await updateAwsNxPluginConfig(tree, {
        license: {
          source: {
            spdx: 'Apache-2.0',
            copyrightHolder: 'Test',
            header: {
              content: { lines: ['Copyright Test Inc.'] },
              format: { '**/*.xyz': { lineStart: '## ' } },
              commentSyntax: { xyz: { line: '##' } },
            },
          },
        },
      });

      const comment = `## Copyright Test Inc.`;
      tree.write('index.xyz', `${comment}\nexport const x = 1;\n`);

      await addStarExport(tree, 'index.xyz', './module');

      expect(tree.read('index.xyz', 'utf-8')).toBe(
        `${comment}\nexport * from './module';\nexport const x = 1;\n`,
      );
    });

    it('should add the export below a leading comment that is not a license header', async () => {
      // The comment block is skipped whatever it says, so no license config is
      // needed and nothing has to guess what a header looks like.
      const comment = `// Export your library code here`;
      tree.write('index.ts', `${comment}\n`);

      await addStarExport(tree, 'index.ts', './module');

      expect(tree.read('index.ts', 'utf-8')).toBe(
        `${comment}\nexport * from './module';\n`,
      );
    });
  });

  describe('addNamedExport', () => {
    it('should add a named export if none exists', async () => {
      tree.write('index.ts', '// Some content\n');

      await addNamedExport(tree, 'index.ts', ['createFoo'], './foo');

      expect(tree.read('index.ts', 'utf-8')).toContain(
        "export { createFoo } from './foo'",
      );
    });

    it('should create the file if it does not exist', async () => {
      await addNamedExport(tree, 'index.ts', ['createFoo'], './foo');

      expect(tree.read('index.ts', 'utf-8')).toBe(
        "export { createFoo } from './foo';\n",
      );
    });

    it('should not duplicate an existing named export', async () => {
      const initialContent = "export { createFoo } from './foo';\n";
      tree.write('index.ts', initialContent);

      await addNamedExport(tree, 'index.ts', ['createFoo'], './foo');

      expect(tree.read('index.ts', 'utf-8')).toBe(initialContent);
    });

    it('should merge into an existing export of the same module', async () => {
      tree.write('index.ts', "export { createFoo } from './foo';\n");

      await addNamedExport(
        tree,
        'index.ts',
        ['createFoo', 'createBar'],
        './foo',
      );

      const written = tree.read('index.ts', 'utf-8');
      expect(written).toContain('createFoo');
      expect(written).toContain('createBar');
      expect(written.match(/from '\.\/foo'/g)).toHaveLength(1);
    });

    it('should leave a user’s other exports in the barrel alone', async () => {
      tree.write('index.ts', "export { createBaz } from './baz';\n");

      await addNamedExport(tree, 'index.ts', ['createFoo'], './foo');

      const written = tree.read('index.ts', 'utf-8');
      expect(written).toContain("export { createBaz } from './baz'");
      expect(written).toContain("export { createFoo } from './foo'");
    });
  });

  describe('hasExportDeclaration', () => {
    it('should return true for exported type alias declarations', async () => {
      const source = `export type MyType = string;`;
      expect(await hasExportDeclaration(tree, source, 'MyType')).toBe(true);
    });

    it('should return false for non-exported type alias declarations', async () => {
      const source = `type MyType = string;`;
      expect(await hasExportDeclaration(tree, source, 'MyType')).toBe(false);
    });

    it('should return true for export declarations', async () => {
      const source = `
        type MyType = string;
        export { MyType };
      `;
      expect(await hasExportDeclaration(tree, source, 'MyType')).toBe(true);
    });

    it('should return false when type alias does not exist', async () => {
      const source = `type OtherType = string;`;
      expect(await hasExportDeclaration(tree, source, 'MyType')).toBe(false);
    });

    it('should return true for re-exported types', async () => {
      const source = `export type { AppRouter } from "./router";`;
      expect(await hasExportDeclaration(tree, source, 'AppRouter')).toBe(true);
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

    it('should support patterns prefixed with a language header', async () => {
      tree.write('file.py', `def greet():\n    print("hello")\n`);

      expect(
        await matchGritQL(tree, 'file.py', 'language python\n`print($msg)`'),
      ).toBe(true);
      expect(
        await matchGritQL(tree, 'file.py', 'language python\n`unused($msg)`'),
      ).toBe(false);
    });
  });

  describe('captureAllGritQLVariable', () => {
    // The binding is the value alone, so a caller never re-derives the syntax
    // around it.
    it('should return the bound value of every match', async () => {
      tree.write(
        'file.ts',
        `const a = { runtime: Runtime.NODEJS_24_X };
const b = { runtime: lambda.Runtime.PYTHON_3_14 };
`,
      );

      expect(
        await captureAllGritQLVariable(
          tree,
          'file.ts',
          '`runtime: $value`',
          'value',
        ),
      ).toEqual(['Runtime.NODEJS_24_X', 'lambda.Runtime.PYTHON_3_14']);
    });

    it('should accept a variable name with or without the sigil', async () => {
      tree.write('file.ts', 'const a = { runtime: X };\n');

      expect(
        await captureAllGritQLVariable(
          tree,
          'file.ts',
          '`runtime: $value`',
          '$value',
        ),
      ).toEqual(['X']);
    });

    // Matched structurally, so a commented-out property is not a match.
    it('should not match inside a comment', async () => {
      tree.write(
        'file.ts',
        '// runtime: Runtime.NODEJS_18_X\nexport const x = 1;\n',
      );

      expect(
        await captureAllGritQLVariable(
          tree,
          'file.ts',
          '`runtime: $value`',
          'value',
        ),
      ).toEqual([]);
    });

    it('should bind a value in another language', async () => {
      tree.write(
        'file.tf',
        'resource "r" "n" {\n  runtime = "nodejs24.x"\n}\n',
      );

      expect(
        await captureAllGritQLVariable(
          tree,
          'file.tf',
          'language hcl\n`runtime = $value`',
          'value',
        ),
      ).toEqual(['"nodejs24.x"']);
    });

    // An empty result and a failure must be distinguishable, or a caller cannot
    // tell "nothing to do" from "the pattern never ran".
    it('should return undefined for a pattern that cannot be applied', async () => {
      tree.write('file.ts', 'export const x = 1;\n');

      expect(
        await captureAllGritQLVariable(tree, 'file.ts', '`unclosed(', 'value'),
      ).toBeUndefined();
    });

    it('should return undefined for a missing file', async () => {
      expect(
        await captureAllGritQLVariable(
          tree,
          'nope.ts',
          '`runtime: $value`',
          'value',
        ),
      ).toBeUndefined();
    });
  });

  describe('addPythonDestructuredImport', () => {
    it('should prepend a new import when the module is not imported yet', async () => {
      tree.write('file.py', 'x = 1\n');

      await addPythonDestructuredImport(tree, 'file.py', ['foo'], 'mymod');

      const written = tree.read('file.py', 'utf-8')!;
      expect(written).toBe('from mymod import foo\nx = 1\n');
    });

    it('should append to an existing single-name import from the same module', async () => {
      tree.write('file.py', 'from mymod import existing\nx = 1\n');

      await addPythonDestructuredImport(tree, 'file.py', ['newer'], 'mymod');

      const written = tree.read('file.py', 'utf-8')!;
      expect(written).toMatch(/from mymod import existing, newer/);
      // No second `from mymod import` line
      expect(written.match(/from mymod import /g)).toHaveLength(1);
    });

    it('should append to an existing multi-name import from the same module', async () => {
      tree.write('file.py', 'from mymod import a, b\nx = 1\n');

      await addPythonDestructuredImport(tree, 'file.py', ['c'], 'mymod');

      const written = tree.read('file.py', 'utf-8')!;
      expect(written).toMatch(/from mymod import a, b, c/);
      expect(written.match(/from mymod import /g)).toHaveLength(1);
    });

    it('should be a no-op when the name is already imported', async () => {
      const initial = 'from mymod import foo\nx = 1\n';
      tree.write('file.py', initial);

      await addPythonDestructuredImport(tree, 'file.py', ['foo'], 'mymod');

      expect(tree.read('file.py', 'utf-8')).toBe(initial);
    });

    it('should be a no-op when all requested names are already imported', async () => {
      const initial = 'from mymod import foo, bar, baz\nx = 1\n';
      tree.write('file.py', initial);

      await addPythonDestructuredImport(
        tree,
        'file.py',
        ['foo', 'bar'],
        'mymod',
      );

      expect(tree.read('file.py', 'utf-8')).toBe(initial);
    });

    it('should append only the missing names when some are already imported', async () => {
      tree.write('file.py', 'from mymod import foo\nx = 1\n');

      await addPythonDestructuredImport(
        tree,
        'file.py',
        ['foo', 'bar', 'baz'],
        'mymod',
      );

      const written = tree.read('file.py', 'utf-8')!;
      expect(written).toMatch(/from mymod import foo, bar, baz/);
      // `foo` appears exactly once in the import list
      const line = written
        .split('\n')
        .find((l) => l.startsWith('from mymod import'));
      expect(line).toBeDefined();
      expect((line!.match(/\bfoo\b/g) ?? []).length).toBe(1);
    });

    it('should not conflate different modules whose names share a prefix', async () => {
      tree.write('file.py', 'from mymod_tools import helper\nx = 1\n');

      await addPythonDestructuredImport(tree, 'file.py', ['foo'], 'mymod');

      const written = tree.read('file.py', 'utf-8')!;
      // New import added as a separate line; the `mymod_tools` line is unchanged.
      expect(written).toContain('from mymod_tools import helper');
      expect(written).toContain('from mymod import foo');
    });

    it('should be idempotent across repeated calls', async () => {
      tree.write('file.py', 'x = 1\n');

      await addPythonDestructuredImport(tree, 'file.py', ['foo'], 'mymod');
      await addPythonDestructuredImport(tree, 'file.py', ['foo'], 'mymod');
      await addPythonDestructuredImport(tree, 'file.py', ['foo'], 'mymod');

      const written = tree.read('file.py', 'utf-8')!;
      expect(written.match(/from mymod import /g)).toHaveLength(1);
      const line = written
        .split('\n')
        .find((l) => l.startsWith('from mymod import'));
      expect((line!.match(/\bfoo\b/g) ?? []).length).toBe(1);
    });

    it('should preserve the rest of the file when prepending', async () => {
      tree.write(
        'file.py',
        `"""Module docstring."""
from contextlib import contextmanager


def hello() -> str:
    return "hi"
`,
      );

      await addPythonDestructuredImport(tree, 'file.py', ['foo'], 'mymod');

      const written = tree.read('file.py', 'utf-8')!;
      expect(written).toContain('"""Module docstring."""');
      expect(written).toContain('from contextlib import contextmanager');
      expect(written).toContain('def hello() -> str:');
      expect(written).toContain('from mymod import foo');
    });
  });

  describe('appendToArrayViaGritQL', () => {
    const append = (entry: string, skipIfContains?: string) =>
      appendToArrayViaGritQL(tree, 'file.ts', 'tools:', entry, {
        scope: 'new Agent($_)',
        skipIfContains,
      });

    it('should append to a single-line array', async () => {
      tree.write('file.ts', `const a = new Agent({ tools: [x, y] });`);

      expect(await append('newTool')).toBe(true);

      expect(tree.read('file.ts', 'utf-8')).toContain('tools: [x, y, newTool]');
    });

    // A wrapped array carries a trailing comma, which a naive append lands after.
    it('should not leave a hole when the array has a trailing comma', async () => {
      tree.write(
        'file.ts',
        `const a = new Agent({
  tools: [
    x,
    y,
  ],
});`,
      );

      expect(await append('newTool')).toBe(true);

      const written = tree.read('file.ts', 'utf-8')!;
      expect(written).not.toMatch(/,\s*,/);
      expect(written).toContain('newTool');
    });

    it('should not leave a hole appending repeatedly to a multi-line array', async () => {
      tree.write(
        'file.ts',
        `const a = new Agent({
  tools: [
    x,
  ],
});`,
      );

      for (const entry of ['firstTool', 'secondTool', 'thirdTool']) {
        expect(await append(entry)).toBe(true);
      }

      const written = tree.read('file.ts', 'utf-8')!;
      expect(written).not.toMatch(/,\s*,/);
      for (const entry of ['firstTool', 'secondTool', 'thirdTool']) {
        expect(written).toContain(entry);
      }
    });

    it('should append to an empty array', async () => {
      tree.write('file.ts', `const a = new Agent({ tools: [] });`);

      expect(await append('newTool')).toBe(true);

      const written = tree.read('file.ts', 'utf-8')!;
      expect(written).not.toMatch(/,\s*,/);
      expect(written).toContain('newTool');
    });

    it('should be idempotent', async () => {
      tree.write('file.ts', `const a = new Agent({ tools: [x] });`);

      expect(await append('newTool')).toBe(true);
      const afterFirst = tree.read('file.ts', 'utf-8')!;
      expect(await append('newTool')).toBe(false);

      expect(tree.read('file.ts', 'utf-8')).toBe(afterFirst);
      expect(afterFirst.match(/newTool/g)).toHaveLength(1);
    });

    it('should dedupe on skipIfContains when given', async () => {
      tree.write(
        'file.ts',
        `const a = new Agent({ tools: [myClient.asTool()] });`,
      );

      expect(await append('myClient.asTool()', 'myClient')).toBe(false);
    });

    it('should leave arrays outside the scope alone', async () => {
      tree.write(
        'file.ts',
        `const other = { tools: [a] };
const agent = new Agent({ tools: [b] });`,
      );

      expect(await append('newTool')).toBe(true);

      const written = tree.read('file.ts', 'utf-8')!;
      expect(written).toContain('const other = { tools: [a] };');
      expect(written).toContain('tools: [b, newTool]');
    });

    it('should return false when the array is not present', async () => {
      tree.write('file.ts', `const a = new Agent({});`);

      expect(await append('newTool')).toBe(false);
    });

    it('should append to a python list without leaving a hole', async () => {
      tree.write(
        'file.py',
        `agent = Agent(
    tools=[
        subtract,
        current_time,
    ],
)
`,
      );

      expect(
        await appendToArrayViaGritQL(tree, 'file.py', 'tools=', 'ask_remote', {
          scope: 'Agent($_)',
          language: 'py',
        }),
      ).toBe(true);

      const written = tree.read('file.py', 'utf-8')!;
      expect(written).not.toMatch(/,\s*,/);
      expect(written).toContain('ask_remote');
    });

    // The separator belongs to the construct, not the language: a python dict key
    // takes `:` where a keyword argument takes `=`.
    it('should append to a python dict entry', async () => {
      tree.write(
        'file.py',
        `cfg = {
    "tools": [subtract],
}
`,
      );

      expect(
        await appendToArrayViaGritQL(
          tree,
          'file.py',
          '"tools":',
          'ask_remote',
          {
            language: 'py',
          },
        ),
      ).toBe(true);

      const written = tree.read('file.py', 'utf-8')!;
      expect(written).not.toMatch(/,\s*,/);
      expect(written).toContain('ask_remote');
    });

    // Pins down which GritQL form is unsafe, so the `=>` variant is not
    // reintroduced on the assumption that any list append is fine: rewriting the
    // list re-emits its trailing comma, while accumulating into it does not.
    it('should not reintroduce the sparse hole that rewriting the list produces', async () => {
      const wrapped = `const a = new Agent({
  tools: [
    x,
    y,
  ],
});`;

      tree.write('rewrite.ts', wrapped);
      await applyGritQL(
        tree,
        'rewrite.ts',
        '`tools: [$items]` => `tools: [$items, newTool]`',
      );
      expect(tree.read('rewrite.ts', 'utf-8')).toMatch(/,\s*,/);

      tree.write('helper.ts', wrapped);
      expect(
        await appendToArrayViaGritQL(tree, 'helper.ts', 'tools:', 'newTool', {
          scope: 'new Agent($_)',
        }),
      ).toBe(true);
      expect(tree.read('helper.ts', 'utf-8')).not.toMatch(/,\s*,/);
    });
  });
});
