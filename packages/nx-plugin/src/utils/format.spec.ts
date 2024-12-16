/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { formatFilesInSubtree } from './format';

describe('format utils', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
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

      // Verify - these should match prettier's default formatting
      expect(tree.read('src/test1.ts')?.toString()).toBe(
        'const x = 1;\nconst y = 2;\nconst z = 3;\n'
      );
      expect(tree.read('src/test2.ts')?.toString()).toBe(
        'function test() {\n  return true;\n}\n'
      );
      // Files outside src should remain unformatted
      expect(tree.read('other/test3.ts')?.toString()).toBe('const y=2;');
    });

    it('should use prettier config from tree if available', async () => {
      // Setup
      tree.write(
        '.prettierrc',
        JSON.stringify({
          semi: false,
          singleQuote: true,
          tabWidth: 2,
        })
      );
      tree.write('src/test.ts', 'const x=1;const y="hello";');

      // Execute
      await formatFilesInSubtree(tree, 'src');

      // Verify - should respect prettier config
      expect(tree.read('src/test.ts')?.toString()).toBe(
        "const x = 1\nconst y = 'hello'\n"
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
  });
});
