/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree, joinPathFragments } from '@nx/devkit';
import {
  sharedConstructsGenerator,
  PACKAGES_DIR,
  TYPE_DEFINITIONS_DIR,
  SHARED_CONSTRUCTS_DIR,
} from './shared-constructs';
import * as npmScopeUtils from './npm-scope';
import { vi } from 'vitest';

describe('shared-constructs utils', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    vi.spyOn(npmScopeUtils, 'getNpmScopePrefix').mockReturnValue(
      '@test-scope/'
    );
    vi.spyOn(npmScopeUtils, 'toScopeAlias').mockReturnValue(':test-scope');
  });

  describe('sharedConstructsGenerator', () => {
    it('should generate type definitions when they do not exist', async () => {
      await sharedConstructsGenerator(tree);

      // Verify project.json was created
      const typeDefsProjectPath = joinPathFragments(
        PACKAGES_DIR,
        TYPE_DEFINITIONS_DIR,
        'project.json'
      );
      expect(tree.exists(typeDefsProjectPath)).toBe(true);

      // Verify src directory was deleted and recreated with template files
      const typeDefsSrcPath = joinPathFragments(
        PACKAGES_DIR,
        TYPE_DEFINITIONS_DIR,
        'src'
      );
      expect(tree.exists(typeDefsSrcPath)).toBe(true);
      expect(tree.exists(joinPathFragments(typeDefsSrcPath, 'index.ts'))).toBe(
        true
      );
    });

    it('should generate shared constructs when they do not exist', async () => {
      await sharedConstructsGenerator(tree);

      // Verify project.json was created
      const constructsProjectPath = joinPathFragments(
        PACKAGES_DIR,
        SHARED_CONSTRUCTS_DIR,
        'project.json'
      );
      expect(tree.exists(constructsProjectPath)).toBe(true);

      // Verify src directory was deleted and recreated with template files
      const constructsSrcPath = joinPathFragments(
        PACKAGES_DIR,
        SHARED_CONSTRUCTS_DIR,
        'src'
      );
      expect(tree.exists(constructsSrcPath)).toBe(true);
      expect(
        tree.exists(joinPathFragments(constructsSrcPath, 'index.ts'))
      ).toBe(true);
    });

    it('should add required dependencies when generating shared constructs', async () => {
      await sharedConstructsGenerator(tree);

      const packageJson = JSON.parse(
        tree.read('package.json', 'utf-8') || '{}'
      );
      expect(packageJson.dependencies).toEqual(
        expect.objectContaining({
          constructs: expect.any(String),
          'aws-cdk-lib': expect.any(String),
        })
      );
    });

    it('should not generate type definitions when they already exist', async () => {
      // Create existing type definitions project
      const typeDefsProjectPath = joinPathFragments(
        PACKAGES_DIR,
        TYPE_DEFINITIONS_DIR,
        'project.json'
      );
      tree.write(typeDefsProjectPath, '{}');

      await sharedConstructsGenerator(tree);

      // Verify src directory was not recreated
      const typeDefsSrcPath = joinPathFragments(
        PACKAGES_DIR,
        TYPE_DEFINITIONS_DIR,
        'src'
      );
      expect(tree.exists(typeDefsSrcPath)).toBe(false);
    });

    it('should not generate shared constructs when they already exist', async () => {
      // Create existing shared constructs project
      const constructsProjectPath = joinPathFragments(
        PACKAGES_DIR,
        SHARED_CONSTRUCTS_DIR,
        'project.json'
      );
      tree.write(constructsProjectPath, '{}');

      await sharedConstructsGenerator(tree);

      // Verify src directory was not recreated
      const constructsSrcPath = joinPathFragments(
        PACKAGES_DIR,
        SHARED_CONSTRUCTS_DIR,
        'src'
      );
      expect(tree.exists(constructsSrcPath)).toBe(false);
    });
  });
});
