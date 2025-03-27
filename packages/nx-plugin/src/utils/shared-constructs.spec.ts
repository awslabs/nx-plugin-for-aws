/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { Tree, joinPathFragments } from '@nx/devkit';
import { sharedConstructsGenerator } from './shared-constructs';
import {
  PACKAGES_DIR,
  TYPE_DEFINITIONS_DIR,
  SHARED_CONSTRUCTS_DIR,
  TYPE_DEFINITIONS_NAME,
  SHARED_CONSTRUCTS_NAME,
} from './shared-constructs-constants';
import { createTreeUsingTsSolutionSetup, snapshotTreeDir } from './test';

describe('shared-constructs utils', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();

    // Set up npm scope in package.json
    tree.write(
      'package.json',
      JSON.stringify({
        name: '@test-scope/source',
        version: '0.0.0',
        license: 'MIT',
        dependencies: {},
        devDependencies: {},
      }),
    );
  });

  describe('sharedConstructsGenerator', () => {
    it('should generate type definitions when they do not exist', async () => {
      await sharedConstructsGenerator(tree);

      // Check if type definitions project was created
      expect(
        tree.exists(
          joinPathFragments(PACKAGES_DIR, TYPE_DEFINITIONS_DIR, 'project.json'),
        ),
      ).toBeTruthy();

      // Check if type definitions source files were generated
      expect(
        tree.exists(
          joinPathFragments(
            PACKAGES_DIR,
            TYPE_DEFINITIONS_DIR,
            'src',
            'index.ts',
          ),
        ),
      ).toBeTruthy();

      // Take snapshots of the generated source files
      snapshotTreeDir(
        tree,
        joinPathFragments(PACKAGES_DIR, TYPE_DEFINITIONS_DIR, 'src'),
      );
    });

    it('should generate shared constructs when they do not exist', async () => {
      await sharedConstructsGenerator(tree);

      // Check if shared constructs project was created
      expect(
        tree.exists(
          joinPathFragments(
            PACKAGES_DIR,
            SHARED_CONSTRUCTS_DIR,
            'project.json',
          ),
        ),
      ).toBeTruthy();

      // Check if shared constructs source files were generated
      expect(
        tree.exists(
          joinPathFragments(
            PACKAGES_DIR,
            SHARED_CONSTRUCTS_DIR,
            'src',
            'index.ts',
          ),
        ),
      ).toBeTruthy();

      // Check if core files were generated
      expect(
        tree.exists(
          joinPathFragments(
            PACKAGES_DIR,
            SHARED_CONSTRUCTS_DIR,
            'src',
            'core',
            'app.ts',
          ),
        ),
      ).toBeTruthy();

      // Take snapshots of the generated source files
      snapshotTreeDir(
        tree,
        joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'src'),
      );
    });

    it('should add required dependencies when generating shared constructs', async () => {
      await sharedConstructsGenerator(tree);

      // Read package.json and check if dependencies were added
      const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));

      expect(packageJson.dependencies).toHaveProperty('constructs');
      expect(packageJson.dependencies).toHaveProperty('aws-cdk-lib');
      expect(packageJson.devDependencies).toHaveProperty('@types/node');
    });

    it('should not generate type definitions when they already exist', async () => {
      // Create type definitions project first
      tree.write(
        joinPathFragments(PACKAGES_DIR, TYPE_DEFINITIONS_DIR, 'project.json'),
        JSON.stringify({
          name: TYPE_DEFINITIONS_NAME,
          sourceRoot: joinPathFragments(
            PACKAGES_DIR,
            TYPE_DEFINITIONS_DIR,
            'src',
          ),
        }),
      );

      // Create a marker file to check if it gets overwritten
      const markerFilePath = joinPathFragments(
        PACKAGES_DIR,
        TYPE_DEFINITIONS_DIR,
        'marker.txt',
      );
      tree.write(markerFilePath, 'This is a marker file');

      await sharedConstructsGenerator(tree);

      // Check if marker file still exists (meaning the directory wasn't recreated)
      expect(tree.exists(markerFilePath)).toBeTruthy();
    });

    it('should not generate shared constructs when they already exist', async () => {
      // Create shared constructs project first
      tree.write(
        joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'project.json'),
        JSON.stringify({
          name: SHARED_CONSTRUCTS_NAME,
          sourceRoot: joinPathFragments(
            PACKAGES_DIR,
            SHARED_CONSTRUCTS_DIR,
            'src',
          ),
        }),
      );

      // Create a marker file to check if it gets overwritten
      const markerFilePath = joinPathFragments(
        PACKAGES_DIR,
        SHARED_CONSTRUCTS_DIR,
        'marker.txt',
      );
      tree.write(markerFilePath, 'This is a marker file');

      await sharedConstructsGenerator(tree);

      // Check if marker file still exists (meaning the directory wasn't recreated)
      expect(tree.exists(markerFilePath)).toBeTruthy();
    });
  });
});
