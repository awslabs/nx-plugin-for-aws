/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  OverwriteStrategy,
  Tree,
  addDependenciesToPackageJson,
  generateFiles,
} from '@nx/devkit';
import {
  sharedConstructsGenerator,
  PACKAGES_DIR,
  TYPE_DEFINITIONS_DIR,
  SHARED_CONSTRUCTS_DIR,
  TYPE_DEFINITIONS_NAME,
  SHARED_CONSTRUCTS_NAME,
} from './shared-constructs';
import * as npmScopeUtils from './npm-scope';
import tsLibGenerator from '../ts/lib/generator';
import { createTreeUsingTsSolutionSetup } from './test';
// Mock dependencies
vi.mock('@nx/devkit', async () => {
  const actual = await vi.importActual('@nx/devkit');
  return {
    ...actual,
    generateFiles: vi.fn(),
    addDependenciesToPackageJson: vi.fn(),
  };
});
vi.mock('../ts/lib/generator', () => ({
  default: vi.fn(),
}));
vi.mock('./npm-scope', () => ({
  getNpmScopePrefix: vi.fn(),
  toScopeAlias: vi.fn(),
}));
describe('shared-constructs utils', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    vi.clearAllMocks();
    vi.spyOn(npmScopeUtils, 'getNpmScopePrefix').mockReturnValue(
      '@test-scope/'
    );
    vi.spyOn(npmScopeUtils, 'toScopeAlias').mockReturnValue(':test-scope');
  });
  describe('sharedConstructsGenerator', () => {
    it('should generate type definitions when they do not exist', async () => {
      vi.spyOn(tree, 'exists').mockImplementation(() => false);
      await sharedConstructsGenerator(tree);
      expect(tsLibGenerator).toHaveBeenCalledWith(tree, {
        name: TYPE_DEFINITIONS_NAME,
        directory: PACKAGES_DIR,
        subDirectory: TYPE_DEFINITIONS_DIR,
      });
      expect(generateFiles).toHaveBeenCalledWith(
        tree,
        expect.stringContaining(TYPE_DEFINITIONS_DIR),
        expect.stringContaining(TYPE_DEFINITIONS_DIR),
        expect.any(Object),
        expect.objectContaining({
          overwriteStrategy: OverwriteStrategy.KeepExisting,
        })
      );
    });
    it('should generate shared constructs when they do not exist', async () => {
      vi.spyOn(tree, 'exists').mockImplementation(() => false);
      await sharedConstructsGenerator(tree);
      expect(tsLibGenerator).toHaveBeenCalledWith(tree, {
        name: SHARED_CONSTRUCTS_NAME,
        directory: PACKAGES_DIR,
        subDirectory: SHARED_CONSTRUCTS_DIR,
      });
      expect(generateFiles).toHaveBeenCalledWith(
        tree,
        expect.stringContaining(SHARED_CONSTRUCTS_DIR),
        expect.stringContaining(SHARED_CONSTRUCTS_DIR),
        expect.objectContaining({
          npmScopePrefix: '@test-scope/',
          scopeAlias: ':test-scope',
        }),
        expect.objectContaining({
          overwriteStrategy: OverwriteStrategy.KeepExisting,
        })
      );
    });
    it('should add required dependencies when generating shared constructs', async () => {
      vi.spyOn(tree, 'exists').mockImplementation(() => false);
      await sharedConstructsGenerator(tree);
      expect(addDependenciesToPackageJson).toHaveBeenCalledWith(
        tree,
        expect.objectContaining({
          constructs: expect.any(String),
          'aws-cdk-lib': expect.any(String),
        }),
        {}
      );
    });
    it('should not generate type definitions when they already exist', async () => {
      vi.spyOn(tree, 'exists').mockImplementation((path) =>
        path.includes(TYPE_DEFINITIONS_DIR)
      );
      await sharedConstructsGenerator(tree);
      expect(tsLibGenerator).not.toHaveBeenCalledWith(
        tree,
        expect.objectContaining({ name: TYPE_DEFINITIONS_NAME })
      );
    });
    it('should not generate shared constructs when they already exist', async () => {
      vi.spyOn(tree, 'exists').mockImplementation((path) =>
        path.includes(SHARED_CONSTRUCTS_DIR)
      );
      await sharedConstructsGenerator(tree);
      expect(tsLibGenerator).not.toHaveBeenCalledWith(
        tree,
        expect.objectContaining({ name: SHARED_CONSTRUCTS_NAME })
      );
    });
  });
});
