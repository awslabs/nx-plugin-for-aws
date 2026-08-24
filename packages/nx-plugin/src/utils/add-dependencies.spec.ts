/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, type Tree, writeJson } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { addPyDependencies, addTsDependencies } from './add-dependencies.js';
import { declareDependencies } from './declared-dependencies.js';
import { createTreeUsingTsSolutionSetup } from './test.js';

describe('add-dependencies', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    writeJson(tree, 'packages/api/package.json', { name: '@proj/api' });
    for (const root of ['packages/api', '.']) {
      tree.write(
        `${root}/pyproject.toml`.replace('./', ''),
        ['[project]', 'name = "api"', 'dependencies = []', ''].join('\n'),
      );
    }
  });

  describe('addTsDependencies', () => {
    // The workspace uses a catalog, so the manifest holds a reference and the
    // version lives in the catalog.
    it('should add a project dependency to the project manifest', () => {
      addTsDependencies(
        tree,
        declareDependencies()({ ts: [{ name: 'zod' }] }),
        {
          projectRoot: 'packages/api',
        },
      );

      expect(
        readJson(tree, 'packages/api/package.json').dependencies.zod,
      ).toBeDefined();
      expect(readJson(tree, 'package.json').dependencies?.zod).toBeUndefined();
    });

    it('should add a root dependency to the workspace manifest', () => {
      addTsDependencies(
        tree,
        declareDependencies()({ ts: [{ name: 'tsx', dev: true, root: true }] }),
        { projectRoot: 'packages/api' },
      );

      expect(readJson(tree, 'package.json').devDependencies.tsx).toBeDefined();
      expect(
        readJson(tree, 'packages/api/package.json').devDependencies,
      ).toBeUndefined();
    });

    // Silently falling back to the root manifest would leave the project failing
    // `noUndeclaredDependencies` on a dependency it imports.
    it('should throw when a project dependency has no projectRoot', () => {
      expect(() =>
        addTsDependencies(
          tree,
          declareDependencies()({ ts: [{ name: 'zod' }] }),
        ),
      ).toThrow(/projectRoot/);
    });

    it('should not require a projectRoot when every entry is root', () => {
      expect(() =>
        addTsDependencies(
          tree,
          declareDependencies()({
            ts: [{ name: 'tsx', dev: true, root: true }],
          }),
        ),
      ).not.toThrow();
    });
  });

  describe('addPyDependencies', () => {
    it('should add a project dependency to the project pyproject', () => {
      addPyDependencies(
        tree,
        declareDependencies()({ py: [{ name: 'boto3' }] }),
        { projectRoot: 'packages/api' },
      );

      expect(tree.read('packages/api/pyproject.toml', 'utf-8')).toContain(
        'boto3',
      );
    });

    it('should throw when a project dependency has no projectRoot', () => {
      expect(() =>
        addPyDependencies(
          tree,
          declareDependencies()({ py: [{ name: 'boto3' }] }),
        ),
      ).toThrow(/projectRoot/);
    });

    it('should not require a projectRoot when every entry is root', () => {
      expect(() =>
        addPyDependencies(
          tree,
          declareDependencies()({
            py: [{ name: 'ruff', group: 'dev', root: true }],
          }),
        ),
      ).not.toThrow();
    });
  });
});
