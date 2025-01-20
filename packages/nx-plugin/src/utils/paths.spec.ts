/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import {
  getRelativePathToRoot,
  getRelativePathToRootByDirectory,
} from './paths';
import * as devkit from '@nx/devkit';
vi.mock('@nx/devkit', async () => {
  const actual = await vi.importActual('@nx/devkit');
  return {
    ...actual,
    readProjectConfiguration: vi.fn(),
  };
});
describe('paths utils', () => {
  describe('getRelativePathToRoot', () => {
    it('should return correct relative path for project in root', () => {
      const tree = createTreeWithEmptyWorkspace();
      vi.spyOn(devkit, 'readProjectConfiguration').mockReturnValue({
        root: 'project',
        sourceRoot: 'project/src',
        projectType: 'application',
      });
      expect(getRelativePathToRoot(tree, 'test-project')).toBe('../');
    });
    it('should return correct relative path for nested project', () => {
      const tree = createTreeWithEmptyWorkspace();
      vi.spyOn(devkit, 'readProjectConfiguration').mockReturnValue({
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
});
