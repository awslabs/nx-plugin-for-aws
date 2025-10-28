/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from './test';
import { expect, describe, it, beforeEach } from 'vitest';
import {
  readProjectConfigurationUnqualified,
  addComponentGeneratorMetadata,
  NxGeneratorInfo,
} from './nx';

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

describe('addComponentGeneratorMetadata', () => {
  let tree: Tree;
  const mockGeneratorInfo: NxGeneratorInfo = {
    id: 'test-generator',
    metric: 'test-metric',
    resolvedFactoryPath: '/path/to/factory',
    resolvedSchemaPath: '/path/to/schema',
    description: 'Test generator description',
  };

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

  it('should add component metadata to project without existing components', () => {
    // Create a project without metadata
    tree.write(
      'apps/test-project/project.json',
      JSON.stringify({
        name: 'test-project',
        root: 'apps/test-project',
        targets: {},
      }),
    );

    addComponentGeneratorMetadata(
      tree,
      'test-project',
      mockGeneratorInfo,
      'test-component',
    );

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );

    expect(projectConfig.metadata).toBeDefined();
    expect(projectConfig.metadata.components).toHaveLength(1);
    expect(projectConfig.metadata.components[0]).toEqual({
      generator: 'test-generator',
      name: 'test-component',
    });
  });

  it('should add component metadata with additional metadata', () => {
    tree.write(
      'apps/test-project/project.json',
      JSON.stringify({
        name: 'test-project',
        root: 'apps/test-project',
        targets: {},
      }),
    );

    addComponentGeneratorMetadata(
      tree,
      'test-project',
      mockGeneratorInfo,
      'test-component',
      {
        port: 8080,
        customField: 'value',
      },
    );

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );

    expect(projectConfig.metadata.components[0]).toEqual({
      generator: 'test-generator',
      name: 'test-component',
      port: 8080,
      customField: 'value',
    });
  });

  it('should add component metadata without component name', () => {
    tree.write(
      'apps/test-project/project.json',
      JSON.stringify({
        name: 'test-project',
        root: 'apps/test-project',
        targets: {},
      }),
    );

    addComponentGeneratorMetadata(
      tree,
      'test-project',
      mockGeneratorInfo,
      undefined,
      {
        port: 3000,
      },
    );

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );

    expect(projectConfig.metadata.components[0]).toEqual({
      generator: 'test-generator',
      port: 3000,
    });
    expect(projectConfig.metadata.components[0].name).toBeUndefined();
  });

  it('should append to existing components array', () => {
    tree.write(
      'apps/test-project/project.json',
      JSON.stringify({
        name: 'test-project',
        root: 'apps/test-project',
        targets: {},
        metadata: {
          components: [
            {
              generator: 'existing-generator',
              name: 'existing-component',
            },
          ],
        },
      }),
    );

    addComponentGeneratorMetadata(
      tree,
      'test-project',
      mockGeneratorInfo,
      'new-component',
    );

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );

    expect(projectConfig.metadata.components).toHaveLength(2);
    expect(projectConfig.metadata.components[0]).toEqual({
      generator: 'existing-generator',
      name: 'existing-component',
    });
    expect(projectConfig.metadata.components[1]).toEqual({
      generator: 'test-generator',
      name: 'new-component',
    });
  });

  it('should not add duplicate component metadata', () => {
    tree.write(
      'apps/test-project/project.json',
      JSON.stringify({
        name: 'test-project',
        root: 'apps/test-project',
        targets: {},
        metadata: {
          components: [
            {
              generator: 'test-generator',
              name: 'test-component',
            },
          ],
        },
      }),
    );

    addComponentGeneratorMetadata(
      tree,
      'test-project',
      mockGeneratorInfo,
      'test-component',
    );

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );

    // Should still have only 1 component
    expect(projectConfig.metadata.components).toHaveLength(1);
    expect(projectConfig.metadata.components[0]).toEqual({
      generator: 'test-generator',
      name: 'test-component',
    });
  });

  it('should preserve existing metadata fields', () => {
    tree.write(
      'apps/test-project/project.json',
      JSON.stringify({
        name: 'test-project',
        root: 'apps/test-project',
        targets: {},
        metadata: {
          generator: 'project-generator',
          otherField: 'value',
        },
      }),
    );

    addComponentGeneratorMetadata(
      tree,
      'test-project',
      mockGeneratorInfo,
      'test-component',
    );

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );

    expect(projectConfig.metadata.generator).toBe('project-generator');
    expect(projectConfig.metadata.otherField).toBe('value');
    expect(projectConfig.metadata.components).toHaveLength(1);
  });

  it('should work with fully qualified project names', () => {
    tree.write(
      'apps/test-project/project.json',
      JSON.stringify({
        name: '@my-scope/test-project',
        root: 'apps/test-project',
        targets: {},
      }),
    );

    addComponentGeneratorMetadata(
      tree,
      'test-project',
      mockGeneratorInfo,
      'test-component',
    );

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );

    expect(projectConfig.metadata.components).toHaveLength(1);
    expect(projectConfig.metadata.components[0]).toEqual({
      generator: 'test-generator',
      name: 'test-component',
    });
  });
});
