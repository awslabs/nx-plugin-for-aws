/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type Tree, writeJson } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  assertModuleFormatCompatible,
  esmVars,
  getEstablishedModuleFormat,
  isEsmWorkspace,
  resolveModuleFormat,
} from './module-format';

describe('resolveModuleFormat', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('returns the explicit format when esm or cjs is passed', () => {
    expect(resolveModuleFormat(tree, 'esm')).toBe('esm');
    expect(resolveModuleFormat(tree, 'cjs')).toBe('cjs');
  });

  it('infers esm from a root package.json with type module', () => {
    writeJson(tree, 'package.json', { name: 'x', type: 'module' });
    expect(resolveModuleFormat(tree, 'infer')).toBe('esm');
  });

  it('infers cjs from a root package.json with explicit type commonjs', () => {
    writeJson(tree, 'package.json', { name: 'x', type: 'commonjs' });
    expect(resolveModuleFormat(tree, 'infer')).toBe('cjs');
  });

  it('defaults to esm when the root package.json has no type', () => {
    writeJson(tree, 'package.json', { name: 'x' });
    expect(resolveModuleFormat(tree, 'infer')).toBe('esm');
  });

  it('defaults to esm when no option is provided', () => {
    writeJson(tree, 'package.json', { name: 'x', type: 'commonjs' });
    // undefined option is treated as infer
    expect(resolveModuleFormat(tree, undefined)).toBe('cjs');
  });

  it('isEsmWorkspace reflects the inferred format', () => {
    writeJson(tree, 'package.json', { name: 'x', type: 'commonjs' });
    expect(isEsmWorkspace(tree)).toBe(false);
    writeJson(tree, 'package.json', { name: 'x', type: 'module' });
    expect(isEsmWorkspace(tree)).toBe(true);
  });

  it('esmVars exposes the esm template flag', () => {
    writeJson(tree, 'package.json', { name: 'x', type: 'module' });
    expect(esmVars(tree)).toEqual({ esm: true });
    writeJson(tree, 'package.json', { name: 'x', type: 'commonjs' });
    expect(esmVars(tree)).toEqual({ esm: false });
  });
});

describe('getEstablishedModuleFormat', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('returns undefined when there is no root package.json', () => {
    tree.delete('package.json');
    expect(getEstablishedModuleFormat(tree)).toBeUndefined();
  });

  it('returns undefined when the root package.json has no type', () => {
    writeJson(tree, 'package.json', { name: 'x' });
    expect(getEstablishedModuleFormat(tree)).toBeUndefined();
  });

  it('returns esm for type module and cjs for type commonjs', () => {
    writeJson(tree, 'package.json', { name: 'x', type: 'module' });
    expect(getEstablishedModuleFormat(tree)).toBe('esm');
    writeJson(tree, 'package.json', { name: 'x', type: 'commonjs' });
    expect(getEstablishedModuleFormat(tree)).toBe('cjs');
  });
});

describe('assertModuleFormatCompatible', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('throws when cjs is requested in an established esm workspace', () => {
    writeJson(tree, 'package.json', { name: 'x', type: 'module' });
    expect(() => assertModuleFormatCompatible(tree, 'cjs')).toThrow(
      /already configured for ES modules/,
    );
  });

  it('throws when esm is requested in an established cjs workspace', () => {
    writeJson(tree, 'package.json', { name: 'x', type: 'commonjs' });
    expect(() => assertModuleFormatCompatible(tree, 'esm')).toThrow(
      /already configured for CommonJS/,
    );
  });

  it('does not throw when the explicit format matches the workspace', () => {
    writeJson(tree, 'package.json', { name: 'x', type: 'module' });
    expect(() => assertModuleFormatCompatible(tree, 'esm')).not.toThrow();
    writeJson(tree, 'package.json', { name: 'x', type: 'commonjs' });
    expect(() => assertModuleFormatCompatible(tree, 'cjs')).not.toThrow();
  });

  it('never throws for infer or an undefined option', () => {
    writeJson(tree, 'package.json', { name: 'x', type: 'module' });
    expect(() => assertModuleFormatCompatible(tree, 'infer')).not.toThrow();
    expect(() => assertModuleFormatCompatible(tree, undefined)).not.toThrow();
    writeJson(tree, 'package.json', { name: 'x', type: 'commonjs' });
    expect(() => assertModuleFormatCompatible(tree, 'infer')).not.toThrow();
  });

  it('does not throw when the workspace has no established format', () => {
    // Fresh workspace with no type: a generator is free to set the format.
    writeJson(tree, 'package.json', { name: 'x' });
    expect(() => assertModuleFormatCompatible(tree, 'cjs')).not.toThrow();
    expect(() => assertModuleFormatCompatible(tree, 'esm')).not.toThrow();
  });
});
