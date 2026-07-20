/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, type Tree, updateJson } from '@nx/devkit';
import yaml from 'js-yaml';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ensureProjectPackageJson,
  ensureWorkspaceGlobCovers,
} from './project-package-json';
import { createTreeUsingTsSolutionSetup } from './test';

describe('ensureProjectPackageJson', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should create a minimal private manifest', () => {
    ensureProjectPackageJson(tree, {
      dir: 'packages/my-lib',
      fullyQualifiedName: '@proj/my-lib',
    });

    expect(readJson(tree, 'packages/my-lib/package.json')).toEqual({
      name: '@proj/my-lib',
      version: '0.0.0',
      private: true,
      type: 'module',
    });
  });

  it('should write commonjs type in a CJS workspace', () => {
    updateJson(tree, 'package.json', (json) => ({
      ...json,
      type: 'commonjs',
    }));

    ensureProjectPackageJson(tree, {
      dir: 'packages/my-lib',
      fullyQualifiedName: '@proj/my-lib',
    });

    expect(readJson(tree, 'packages/my-lib/package.json').type).toBe(
      'commonjs',
    );
  });

  it('should preserve user-added fields on re-run', () => {
    ensureProjectPackageJson(tree, {
      dir: 'packages/my-lib',
      fullyQualifiedName: '@proj/my-lib',
    });
    updateJson(tree, 'packages/my-lib/package.json', (json) => ({
      ...json,
      dependencies: { zod: 'catalog:' },
    }));

    ensureProjectPackageJson(tree, {
      dir: 'packages/my-lib',
      fullyQualifiedName: '@proj/my-lib',
    });

    expect(
      readJson(tree, 'packages/my-lib/package.json').dependencies.zod,
    ).toBe('catalog:');
  });

  it('should strip dist entry points left by @nx/js', () => {
    tree.write(
      'packages/my-lib/package.json',
      JSON.stringify({
        name: '@proj/my-lib',
        main: './dist/index.js',
        module: './dist/index.js',
        types: './dist/index.d.ts',
        exports: {
          '.': {
            types: './dist/index.d.ts',
            import: './dist/index.js',
            default: './dist/index.js',
          },
        },
      }),
    );

    ensureProjectPackageJson(tree, {
      dir: 'packages/my-lib',
      fullyQualifiedName: '@proj/my-lib',
    });

    const packageJson = readJson(tree, 'packages/my-lib/package.json');
    expect(packageJson.main).toBeUndefined();
    expect(packageJson.module).toBeUndefined();
    expect(packageJson.types).toBeUndefined();
    expect(packageJson.exports).toBeUndefined();
  });

  it('should keep customised entry points', () => {
    tree.write(
      'packages/my-lib/package.json',
      JSON.stringify({
        name: '@proj/my-lib',
        main: './lib/custom.js',
      }),
    );

    ensureProjectPackageJson(tree, {
      dir: 'packages/my-lib',
      fullyQualifiedName: '@proj/my-lib',
    });

    expect(readJson(tree, 'packages/my-lib/package.json').main).toBe(
      './lib/custom.js',
    );
  });
});

describe('ensureWorkspaceGlobCovers', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should be a no-op when an existing glob covers the directory', () => {
    const before = tree.read('pnpm-workspace.yaml', 'utf-8');

    ensureWorkspaceGlobCovers(tree, 'packages/my-lib');

    expect(tree.read('pnpm-workspace.yaml', 'utf-8')).toEqual(before);
  });

  it('should add an entry for a directory not covered by existing globs', () => {
    ensureWorkspaceGlobCovers(tree, 'apps/nested/my-app');

    const workspaceYaml = yaml.load(
      tree.read('pnpm-workspace.yaml', 'utf-8'),
    ) as any;
    expect(workspaceYaml.packages).toContain('apps/nested/my-app');
  });

  it('should update the package.json workspaces field when pnpm-workspace.yaml is absent', () => {
    tree.delete('pnpm-workspace.yaml');

    ensureWorkspaceGlobCovers(tree, 'apps/my-app');

    expect(readJson(tree, 'package.json').workspaces).toContain('apps/my-app');
  });

  it('should add an entry for a directory only matched by a negated glob', () => {
    tree.write(
      'pnpm-workspace.yaml',
      yaml.dump({ packages: ['packages/*', '!packages/excluded'] }),
    );

    ensureWorkspaceGlobCovers(tree, 'libs/my-lib');

    const workspaceYaml = yaml.load(
      tree.read('pnpm-workspace.yaml', 'utf-8'),
    ) as any;
    expect(workspaceYaml.packages).toContain('libs/my-lib');
  });

  it('should treat a directory excluded by a negated glob as uncovered', () => {
    tree.write(
      'pnpm-workspace.yaml',
      yaml.dump({ packages: ['packages/*', '!packages/excluded'] }),
    );

    ensureWorkspaceGlobCovers(tree, 'packages/excluded');

    const workspaceYaml = yaml.load(
      tree.read('pnpm-workspace.yaml', 'utf-8'),
    ) as any;
    expect(workspaceYaml.packages).toContain('packages/excluded');
  });

  it('should be a no-op for a covered directory when negated globs exist', () => {
    tree.write(
      'pnpm-workspace.yaml',
      yaml.dump({ packages: ['packages/*', '!packages/excluded'] }),
    );
    const before = tree.read('pnpm-workspace.yaml', 'utf-8');

    ensureWorkspaceGlobCovers(tree, 'packages/my-lib');

    expect(tree.read('pnpm-workspace.yaml', 'utf-8')).toEqual(before);
  });
});
