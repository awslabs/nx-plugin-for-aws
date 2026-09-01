/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import TOML from '@iarna/toml';
import { createTree } from '@nx/devkit/testing';
import { tryReadToml, updateToml } from './toml.js';

describe('toml utils', () => {
  describe('updateToml', () => {
    it('should update an existing toml file', () => {
      const tree = createTree();
      const initialContent = `
[package]
name = "my-package"
version = "1.0.0"
`;
      const filePath = 'test.toml';
      tree.write(filePath, initialContent);

      updateToml(tree, filePath, (prev: TOML.JsonMap) => ({
        package: {
          name: (prev.package as TOML.JsonMap).name,
          version: '2.0.0',
        },
      }));

      const updatedContent = tree.read(filePath, 'utf-8');
      const parsed = TOML.parse(updatedContent);
      expect(parsed).toEqual({
        package: {
          name: 'my-package',
          version: '2.0.0',
        },
      });
    });

    it('should throw if file does not exist', () => {
      const tree = createTree();
      const filePath = 'nonexistent.toml';

      expect(() => {
        updateToml(tree, filePath, () => ({}));
      }).toThrow(`${filePath} does not exist`);
    });
  });

  describe('tryReadToml', () => {
    it('should read an existing toml file', () => {
      const tree = createTree();
      tree.write('test.toml', '[package]\nname = "my-package"\n');

      expect(tryReadToml(tree, 'test.toml')).toEqual({
        package: { name: 'my-package' },
      });
    });

    it('should return undefined for a file that does not exist', () => {
      expect(tryReadToml(createTree(), 'nonexistent.toml')).toBeUndefined();
    });

    it('should return undefined for a file that cannot be parsed', () => {
      const tree = createTree();
      tree.write('broken.toml', '[package\nname =');

      expect(tryReadToml(tree, 'broken.toml')).toBeUndefined();
    });
  });
});
