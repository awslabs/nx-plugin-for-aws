/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ProjectConfiguration, Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addComponentGeneratorMetadata,
  addDependencyToTargetIfNotPresent,
  addComponentDevTarget,
  addGeneratorMetadata,
  type NxGeneratorInfo,
  normalizeTargetKeyOrder,
  readProjectConfigurationUnqualified,
} from './nx';
import { createTreeUsingTsSolutionSetup } from './test';

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

describe('addGeneratorMetadata', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    tree.write(
      'package.json',
      JSON.stringify({ name: '@my-scope/monorepo', version: '1.0.0' }),
    );
  });

  it('should add generator metadata to the project', () => {
    tree.write(
      'apps/test-project/project.json',
      JSON.stringify({
        name: 'test-project',
        root: 'apps/test-project',
        targets: { build: { executor: 'nx:noop' } },
      }),
    );

    addGeneratorMetadata(tree, 'test-project', { id: 'ts#foo' });

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.metadata).toEqual({ generator: 'ts#foo' });
  });

  it('should not rewrite project.json when re-run with the same metadata', () => {
    tree.write(
      'apps/test-project/project.json',
      JSON.stringify({
        name: 'test-project',
        root: 'apps/test-project',
        targets: { build: { executor: 'nx:noop' } },
      }),
    );

    addGeneratorMetadata(tree, 'test-project', { id: 'ts#foo' });
    const first = tree.read('apps/test-project/project.json', 'utf-8');

    addGeneratorMetadata(tree, 'test-project', { id: 'ts#foo' });
    const second = tree.read('apps/test-project/project.json', 'utf-8');

    // Re-running must leave the file byte-identical (no key reorder)
    expect(second).toEqual(first);
  });

  it('should update metadata when additional metadata changes', () => {
    tree.write(
      'apps/test-project/project.json',
      JSON.stringify({
        name: 'test-project',
        root: 'apps/test-project',
        targets: {},
      }),
    );

    addGeneratorMetadata(tree, 'test-project', { id: 'ts#foo' });
    addGeneratorMetadata(
      tree,
      'test-project',
      { id: 'ts#foo' },
      { port: 4200 },
    );

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.metadata).toEqual({
      generator: 'ts#foo',
      port: 4200,
    });
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
      'src/test-component',
      'test-component',
    );

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );

    expect(projectConfig.metadata).toBeDefined();
    expect(projectConfig.metadata.components).toHaveLength(1);
    expect(projectConfig.metadata.components[0]).toEqual({
      generator: 'test-generator',
      path: 'src/test-component',
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
      'src/test-component',
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
      path: 'src/test-component',
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
      'src/unnamed-component',
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
      path: 'src/unnamed-component',
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
      'src/new-component',
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
      path: 'src/new-component',
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
      'src/test-component',
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
      'src/test-component',
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
      'src/test-component',
      'test-component',
    );

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );

    expect(projectConfig.metadata.components).toHaveLength(1);
    expect(projectConfig.metadata.components[0]).toEqual({
      generator: 'test-generator',
      path: 'src/test-component',
      name: 'test-component',
    });
  });
});

describe('addDependencyToTargetIfNotPresent', () => {
  const makeProject = (): ProjectConfiguration => ({
    name: 'test-project',
    root: 'apps/test-project',
  });

  it('should create the target if it does not exist', () => {
    const project = makeProject();
    addDependencyToTargetIfNotPresent(project, 'build', 'lint');
    expect(project.targets?.build?.dependsOn).toEqual(['lint']);
  });

  it('should add a string dependency to an existing target', () => {
    const project = makeProject();
    project.targets = { build: { dependsOn: ['compile'] } };
    addDependencyToTargetIfNotPresent(project, 'build', 'bundle');
    expect(project.targets.build.dependsOn).toEqual(['compile', 'bundle']);
  });

  it('should not duplicate a string dependency', () => {
    const project = makeProject();
    project.targets = { build: { dependsOn: ['compile', 'bundle'] } };
    addDependencyToTargetIfNotPresent(project, 'build', 'bundle');
    expect(project.targets.build.dependsOn).toEqual(['compile', 'bundle']);
  });

  it('should add an object dependency', () => {
    const project = makeProject();
    addDependencyToTargetIfNotPresent(project, 'dev', {
      projects: ['other-project'],
      target: 'dev',
    });
    expect(project.targets?.['dev']?.dependsOn).toEqual([
      { projects: ['other-project'], target: 'dev' },
    ]);
  });

  it('should not duplicate an object dependency with identical projects/target', () => {
    const project = makeProject();
    project.targets = {
      'dev': {
        dependsOn: [{ projects: ['other-project'], target: 'dev' }],
      },
    };
    addDependencyToTargetIfNotPresent(project, 'dev', {
      projects: ['other-project'],
      target: 'dev',
    });
    expect(project.targets['dev'].dependsOn).toEqual([
      { projects: ['other-project'], target: 'dev' },
    ]);
  });

  it('should treat string-projects and single-element-array-projects as equivalent', () => {
    const project = makeProject();
    project.targets = {
      'dev': {
        dependsOn: [{ projects: 'other-project', target: 'dev' }],
      },
    };
    addDependencyToTargetIfNotPresent(project, 'dev', {
      projects: ['other-project'],
      target: 'dev',
    });
    expect(project.targets['dev'].dependsOn).toHaveLength(1);
  });

  it('should consider object dependencies with different targets as distinct', () => {
    const project = makeProject();
    project.targets = {
      'dev': {
        dependsOn: [{ projects: ['api'], target: 'dev' }],
      },
    };
    addDependencyToTargetIfNotPresent(project, 'dev', {
      projects: ['api'],
      target: 'serve-watch',
    });
    expect(project.targets['dev'].dependsOn).toEqual([
      { projects: ['api'], target: 'dev' },
      { projects: ['api'], target: 'serve-watch' },
    ]);
  });

  it('should be idempotent when called repeatedly with the same inputs', () => {
    const project = makeProject();
    for (let i = 0; i < 5; i++) {
      addDependencyToTargetIfNotPresent(project, 'build', 'compile');
      addDependencyToTargetIfNotPresent(project, 'build', {
        projects: ['other'],
        target: 'build',
      });
    }
    expect(project.targets?.build?.dependsOn).toEqual([
      'compile',
      { projects: ['other'], target: 'build' },
    ]);
  });

  it('should not reorder existing dependencies when re-adding one in the middle', () => {
    const project = makeProject();
    project.targets = {
      build: {
        dependsOn: [
          '@e2e/website:build',
          '@e2e/website-no-router:build',
          '^build',
        ],
      },
    };
    addDependencyToTargetIfNotPresent(project, 'build', '@e2e/website:build');
    addDependencyToTargetIfNotPresent(
      project,
      'build',
      '@e2e/website-no-router:build',
    );
    expect(project.targets.build.dependsOn).toEqual([
      '@e2e/website:build',
      '@e2e/website-no-router:build',
      '^build',
    ]);
  });
});

describe('normalizeTargetKeyOrder', () => {
  it('should order keys to match Nx serialization so generators are idempotent', () => {
    const normalized = normalizeTargetKeyOrder({
      options: { command: 'foo' },
      continuous: true,
      executor: 'nx:run-commands',
      dependsOn: ['compile'],
    });
    expect(Object.keys(normalized)).toEqual([
      'executor',
      'dependsOn',
      'continuous',
      'options',
    ]);
  });

  it('should place unknown keys after known keys, preserving value identity', () => {
    const options = { command: 'foo' };
    const normalized = normalizeTargetKeyOrder({
      custom: 'x',
      options,
      executor: 'nx:run-commands',
    });
    expect(Object.keys(normalized)).toEqual(['executor', 'options', 'custom']);
    expect(normalized.options).toBe(options);
  });
});

describe('addComponentDevTarget', () => {
  it('should create a project-level dev aggregating the component dev target', () => {
    const targets: any = { 'my-mcp-dev': { continuous: true } };
    addComponentDevTarget(targets, 'my-mcp-dev');
    expect(targets.dev).toEqual({
      continuous: true,
      dependsOn: ['my-mcp-dev'],
    });
  });

  it('should accumulate each component dev target under the project dev', () => {
    const targets: any = {
      dev: { continuous: true, dependsOn: ['first-dev'] },
      'second-dev': { continuous: true },
    };
    addComponentDevTarget(targets, 'second-dev');
    // Project-level dev runs both components
    expect(targets.dev.dependsOn).toEqual(['first-dev', 'second-dev']);
  });

  it('should not duplicate a component dev target on re-run', () => {
    const targets: any = { 'my-mcp-dev': { continuous: true } };
    addComponentDevTarget(targets, 'my-mcp-dev');
    addComponentDevTarget(targets, 'my-mcp-dev');
    expect(targets.dev.dependsOn).toEqual(['my-mcp-dev']);
  });
});
