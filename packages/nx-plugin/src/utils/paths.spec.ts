/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree, addProjectConfiguration } from '@nx/devkit';
import {
  getRelativePathToRoot,
  getRelativePathToRootByDirectory,
  getRelativePathWithinTree,
} from './paths';

describe('paths utils', () => {
  describe('getRelativePathToRoot', () => {
    it('should return correct relative path for project in root', () => {
      const tree = createTreeWithEmptyWorkspace();
      addProjectConfiguration(tree, 'test-project', {
        root: 'project',
        sourceRoot: 'project/src',
        projectType: 'application',
      });

      expect(getRelativePathToRoot(tree, 'test-project')).toBe('../');
    });

    it('should return correct relative path for nested project', () => {
      const tree = createTreeWithEmptyWorkspace();
      addProjectConfiguration(tree, 'test-project', {
        root: 'apps/nested/project',
        sourceRoot: 'apps/nested/project/src',
        projectType: 'application',
      });

      expect(getRelativePathToRoot(tree, 'test-project')).toBe('../../../');
    });
  });

  describe('getRelativePathToRootByDirectory', () => {
    it('should return empty string for root directory', () => {
      expect(getRelativePathToRootByDirectory('')).toBe('');
    });

    it('should return "../" for single level directory', () => {
      expect(getRelativePathToRootByDirectory('project')).toBe('../');
    });

    it('should return correct path for nested directory', () => {
      expect(getRelativePathToRootByDirectory('apps/nested/project')).toBe(
        '../../../'
      );
    });

    it('should handle directories with trailing slash', () => {
      expect(getRelativePathToRootByDirectory('apps/nested/project/')).toBe(
        '../../../'
      );
    });

    it('should handle directories with leading slash', () => {
      expect(getRelativePathToRootByDirectory('/apps/nested/project')).toBe(
        '../../../'
      );
    });
  });

  describe('getRelativePathWithinTree', () => {
    it('should find the relative path within the tree', () => {
      const tree = createTreeWithEmptyWorkspace();

      expect(getRelativePathWithinTree(tree, 'foo/bar', 'foo/baz')).toBe(
        '../baz'
      );
      expect(getRelativePathWithinTree(tree, 'foo/bar', 'baz/bat')).toBe(
        '../../baz/bat'
      );
      expect(
        getRelativePathWithinTree(
          tree,
          'packages/generated/typescript',
          'dist/packages/foo/bar'
        )
      ).toBe('../../../dist/packages/foo/bar');
    });
  });
});
