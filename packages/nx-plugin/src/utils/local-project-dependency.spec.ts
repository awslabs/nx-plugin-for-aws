/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, type Tree, writeJson } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { addLocalProjectDependency } from './local-project-dependency.js';
import { createTreeUsingTsSolutionSetup } from './test.js';

describe('addLocalProjectDependency', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    writeJson(tree, 'packages/api/package.json', { name: '@proj/api' });
    writeJson(tree, 'packages/website/package.json', { name: '@proj/website' });
  });

  it('should declare the dependency in the consumer manifest', () => {
    addLocalProjectDependency(tree, {
      consumerRoot: 'packages/website',
      dependencyRoot: 'packages/api',
    });

    expect(
      readJson(tree, 'packages/website/package.json').dependencies['@proj/api'],
    ).toBe('workspace:*');
  });

  it('should be a no-op on re-run', () => {
    addLocalProjectDependency(tree, {
      consumerRoot: 'packages/website',
      dependencyRoot: 'packages/api',
    });
    const manifest = tree.read('packages/website/package.json', 'utf-8');

    addLocalProjectDependency(tree, {
      consumerRoot: 'packages/website',
      dependencyRoot: 'packages/api',
    });

    expect(tree.read('packages/website/package.json', 'utf-8')).toBe(manifest);
  });

  it('should preserve a version the user already declared', () => {
    writeJson(tree, 'packages/website/package.json', {
      name: '@proj/website',
      dependencies: { '@proj/api': '1.2.3' },
    });

    addLocalProjectDependency(tree, {
      consumerRoot: 'packages/website',
      dependencyRoot: 'packages/api',
    });

    expect(
      readJson(tree, 'packages/website/package.json').dependencies['@proj/api'],
    ).toBe('1.2.3');
  });

  it('should preserve a declaration the user moved to devDependencies', () => {
    writeJson(tree, 'packages/website/package.json', {
      name: '@proj/website',
      devDependencies: { '@proj/api': 'workspace:*' },
    });

    addLocalProjectDependency(tree, {
      consumerRoot: 'packages/website',
      dependencyRoot: 'packages/api',
    });

    expect(
      readJson(tree, 'packages/website/package.json').dependencies,
    ).toBeUndefined();
  });

  // Project references belong to `@nx/js:typescript-sync`, which resolves the
  // tsconfig a dependency maps to. Writing one here would append a second
  // reference to the same project once sync had rewritten the first.
  it('should not touch the consumer tsconfig', () => {
    writeJson(tree, 'packages/website/tsconfig.app.json', { references: [] });

    addLocalProjectDependency(tree, {
      consumerRoot: 'packages/website',
      dependencyRoot: 'packages/api',
    });

    expect(
      readJson(tree, 'packages/website/tsconfig.app.json').references,
    ).toEqual([]);
  });

  it('should do nothing when the dependency has no package.json', () => {
    addLocalProjectDependency(tree, {
      consumerRoot: 'packages/website',
      dependencyRoot: 'packages/missing',
    });

    expect(
      readJson(tree, 'packages/website/package.json').dependencies,
    ).toBeUndefined();
  });
});
