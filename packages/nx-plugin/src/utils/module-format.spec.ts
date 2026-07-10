/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type Tree, writeJson } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { esmVars, isEsmWorkspace } from './module-format';

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

  it('defaults to esm when the root package.json has no type', () => {
    writeJson(tree, 'package.json', { name: 'x' });
    expect(isEsmWorkspace(tree)).toBe(true);
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
