/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree, writeJson } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { esmVars, isEsmWorkspace } from './module-format';

/**
 * Register a project with its own package.json declaring the given module
 * format, mirroring how Nx's TS-solution libraries carry a per-project `type`.
 */
const addProjectWithType = (tree: Tree, name: string, type?: string) => {
  const root = `packages/${name}`;
  addProjectConfiguration(tree, name, { root, sourceRoot: `${root}/src` });
  writeJson(tree, `${root}/package.json`, {
    name,
    ...(type ? { type } : {}),
  });
};

describe('isEsmWorkspace', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('treats a root package.json with type module as esm', () => {
    writeJson(tree, 'package.json', { name: 'x', type: 'module' });
    expect(isEsmWorkspace(tree)).toBe(true);
  });

  it('treats a root package.json with explicit type commonjs as cjs', () => {
    writeJson(tree, 'package.json', { name: 'x', type: 'commonjs' });
    expect(isEsmWorkspace(tree)).toBe(false);
  });

  it('treats a root type commonjs as cjs even when a project is esm', () => {
    writeJson(tree, 'package.json', { name: 'x', type: 'commonjs' });
    addProjectWithType(tree, 'esm-lib', 'module');
    expect(isEsmWorkspace(tree)).toBe(false);
  });

  it('treats a root package.json with no type and no projects as cjs', () => {
    writeJson(tree, 'package.json', { name: 'x' });
    expect(isEsmWorkspace(tree)).toBe(false);
  });

  it('infers esm from a sibling project when the root type is absent', () => {
    writeJson(tree, 'package.json', { name: 'x' });
    addProjectWithType(tree, 'plain', undefined);
    addProjectWithType(tree, 'esm-lib', 'module');
    expect(isEsmWorkspace(tree)).toBe(true);
  });

  it('stays cjs when the root type is absent and no project is esm', () => {
    writeJson(tree, 'package.json', { name: 'x' });
    addProjectWithType(tree, 'plain', undefined);
    addProjectWithType(tree, 'cjs-lib', 'commonjs');
    expect(isEsmWorkspace(tree)).toBe(false);
  });

  it('defaults to esm when there is no root package.json', () => {
    tree.delete('package.json');
    expect(isEsmWorkspace(tree)).toBe(true);
  });

  it('esmVars exposes the esm template flag', () => {
    writeJson(tree, 'package.json', { name: 'x', type: 'module' });
    expect(esmVars(tree)).toEqual({ esm: true });
    writeJson(tree, 'package.json', { name: 'x', type: 'commonjs' });
    expect(esmVars(tree)).toEqual({ esm: false });
  });
});
