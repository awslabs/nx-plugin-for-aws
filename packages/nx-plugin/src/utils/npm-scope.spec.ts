/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { getNpmScope, getNpmScopePrefix } from './npm-scope';
import { createTreeUsingTsSolutionSetup } from './test';

describe('npm-scope utils', () => {
  describe('getNpmScope', () => {
    it('should return monorepo when package.json does not exist', () => {
      const tree = createTreeUsingTsSolutionSetup();
      tree.delete('package.json');
      expect(getNpmScope(tree)).toEqual('monorepo');
    });
    it('should return undefined when package.json has no name', () => {
      const tree = createTreeUsingTsSolutionSetup();
      tree.write('package.json', JSON.stringify({}));
      expect(getNpmScope(tree)).toEqual('monorepo');
    });
    it('should return undefined when package name has no scope', () => {
      const tree = createTreeUsingTsSolutionSetup();
      tree.write('package.json', JSON.stringify({ name: 'my-package' }));
      expect(getNpmScope(tree)).toEqual('monorepo');
    });
    it('should return scope name when package has scope', () => {
      const tree = createTreeUsingTsSolutionSetup();
      tree.write(
        'package.json',
        JSON.stringify({ name: '@my-org/my-package' }),
      );
      expect(getNpmScope(tree)).toBe('my-org');
    });
  });
  describe('getNpmScopePrefix', () => {
    it('should return undefined when no scope exists', () => {
      const tree = createTreeUsingTsSolutionSetup();
      tree.delete('package.json');
      expect(getNpmScopePrefix(tree)).toEqual('@monorepo/');
    });
    it('should return scope with @ prefix when scope exists', () => {
      const tree = createTreeUsingTsSolutionSetup();
      tree.write(
        'package.json',
        JSON.stringify({ name: '@my-org/my-package' }),
      );
      expect(getNpmScopePrefix(tree)).toBe('@my-org/');
    });
  });
});
