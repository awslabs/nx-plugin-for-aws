/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from './test';
import { expect, describe, it, beforeEach } from 'vitest';
import { readProjectConfigurationUnqualified } from './nx';

describe('readProjectConfigurationUnqualified', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();

    // Setup package.json with a scope
    tree.write(
      'package.json',
      JSON.stringify({
        name: '@my-scope/monorepo',
        version: '1.0.0',
      }),
    );
  });

  it('should find project with direct name', () => {
    // Create a project with a direct name
    tree.write(
      'apps/direct-project/project.json',
      JSON.stringify({
        name: 'direct-project',
        root: 'apps/direct-project',
      }),
    );

    const result = readProjectConfigurationUnqualified(tree, 'direct-project');

    expect(result.name).toBe('direct-project');
    expect(result.root).toBe('apps/direct-project');
  });

  it('should find project with TypeScript fully qualified name', () => {
    // Create a project with a TypeScript fully qualified name
    tree.write(
      'apps/ts-project/project.json',
      JSON.stringify({
        name: '@my-scope/ts-project',
        root: 'apps/ts-project',
      }),
    );

    // Should be able to find it with the unqualified name
    const result = readProjectConfigurationUnqualified(tree, 'ts-project');

    expect(result.name).toBe('@my-scope/ts-project');
    expect(result.root).toBe('apps/ts-project');
  });

  it('should find project with Python fully qualified name', () => {
    // Create a project with a Python fully qualified name
    tree.write(
      'apps/py-project/project.json',
      JSON.stringify({
        name: 'my_scope.py-project',
        root: 'apps/py-project',
      }),
    );

    // Should be able to find it with the unqualified name
    const result = readProjectConfigurationUnqualified(tree, 'py-project');

    expect(result.name).toBe('my_scope.py-project');
    expect(result.root).toBe('apps/py-project');
  });

  it('should throw error if project is not found', () => {
    // Should throw an error for a non-existent project
    expect(() =>
      readProjectConfigurationUnqualified(tree, 'non-existent-project'),
    ).toThrow(/Cannot find configuration for 'non-existent-project'/);
  });
});
