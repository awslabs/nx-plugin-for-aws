/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Tree } from '@nx/devkit';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatFilesInSubtree } from './format';
import { createTreeUsingTsSolutionSetup } from './test';

describe('format utils', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });
  describe('formatFilesInSubtree', () => {
    it('should format files in the given directory', async () => {
      // Setup
      const testFiles = {
        'src/test1.ts': 'const x=1;const y=2;const z=3;',
        'src/test2.ts': 'function test(){return true}',
        'other/test3.ts': 'const y=2;',
      };
      Object.entries(testFiles).forEach(([path, content]) => {
        tree.write(path, content);
      });
      // Execute
      await formatFilesInSubtree(tree, 'src');
      // Verify - these should match biome's formatting with our default config
      expect(tree.read('src/test1.ts')?.toString()).toBe(
        'const x = 1;\nconst y = 2;\nconst z = 3;\n',
      );
      expect(tree.read('src/test2.ts')?.toString()).toBe(
        'function test() {\n  return true;\n}\n',
      );
      // Files outside src should remain unformatted
      expect(tree.read('other/test3.ts')?.toString()).toBe('const y=2;');
    });
    it('should use biome config from tree if available', async () => {
      // Setup - biome config with no semicolons
      tree.write(
        'biome.json',
        JSON.stringify({
          formatter: { indentStyle: 'space', indentWidth: 2 },
          javascript: {
            formatter: { quoteStyle: 'single', semicolons: 'asNeeded' },
          },
        }),
      );
      tree.write('src/test.ts', 'const x=1;const y="hello";');
      // Execute
      await formatFilesInSubtree(tree, 'src');
      // Verify - should respect biome config (no semicolons, single quotes)
      expect(tree.read('src/test.ts')?.toString()).toBe(
        "const x = 1\nconst y = 'hello'\n",
      );
    });
    it('should apply in-tree config changes without writing a config file', async () => {
      // Setup - in-memory config change made within this generator run (tabs)
      tree.write(
        'biome.json',
        JSON.stringify({
          formatter: { indentStyle: 'tab' },
          javascript: { formatter: { quoteStyle: 'double' } },
        }),
      );
      tree.write('src/test.ts', 'function f(){const x="hi";return x}');
      // Execute
      await formatFilesInSubtree(tree, 'src');
      // Verify - tab indentation and double quotes from the in-tree config
      expect(tree.read('src/test.ts')?.toString()).toBe(
        'function f() {\n\tconst x = "hi";\n\treturn x;\n}\n',
      );
    });
    it('should not format deleted files', async () => {
      // Setup
      tree.write('src/test.ts', 'const x=1;');
      tree.delete('src/test.ts');
      // Execute
      await formatFilesInSubtree(tree, 'src');
      // Verify
      expect(tree.exists('src/test.ts')).toBe(false);
    });
    it('should format all changed files when no directory is given', async () => {
      // Setup
      tree.write('src/test.ts', 'const x=1;');
      tree.write('lib/test.ts', 'const y=2;');
      // Execute
      await formatFilesInSubtree(tree);
      // Verify - both files are formatted
      expect(tree.read('src/test.ts')?.toString()).toBe('const x = 1;\n');
      expect(tree.read('lib/test.ts')?.toString()).toBe('const y = 2;\n');
    });
    it('should format json and css files', async () => {
      // Setup
      tree.write('src/data.json', '{"a":1,"b":2}');
      tree.write('src/styles.css', '.a{color:red}');
      // Execute
      await formatFilesInSubtree(tree, 'src');
      // Verify
      expect(tree.read('src/data.json')?.toString()).toBe(
        '{ "a": 1, "b": 2 }\n',
      );
      expect(tree.read('src/styles.css')?.toString()).toBe(
        '.a {\n  color: red;\n}\n',
      );
    });
  });

  describe('formatFilesInSubtree with an on-disk biome.json', () => {
    let workspaceDir: string;
    beforeEach(() => {
      // Point the tree at a real directory so the on-disk biome.json is used.
      workspaceDir = mkdtempSync(path.join(tmpdir(), 'nx-plugin-format-'));
      tree.root = workspaceDir;
    });
    afterEach(() => {
      rmSync(workspaceDir, { recursive: true, force: true });
    });
    it("should format using the workspace's on-disk biome config", async () => {
      // Setup - on-disk config with no semicolons and single quotes
      writeFileSync(
        path.join(workspaceDir, 'biome.json'),
        JSON.stringify({
          $schema: 'https://biomejs.dev/schemas/2.4.16/schema.json',
          root: true,
          formatter: { indentStyle: 'space', indentWidth: 2 },
          javascript: {
            formatter: { quoteStyle: 'single', semicolons: 'asNeeded' },
          },
        }),
      );
      tree.write('src/test.ts', 'const x=1;const y="hello";');
      // Execute
      await formatFilesInSubtree(tree, 'src');
      // Verify - respects the on-disk config (no semicolons, single quotes)
      expect(tree.read('src/test.ts')?.toString()).toBe(
        "const x = 1\nconst y = 'hello'\n",
      );
    });
  });
});
