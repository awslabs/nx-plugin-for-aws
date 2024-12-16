/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree } from '@nx/devkit';

import { typeSafeRestApiGenerator } from './generator';
import { TypeSafeRestApiGeneratorSchema } from './schema';

describe('type-safe-api rest generator', () => {
  let tree: Tree;
  const options: TypeSafeRestApiGeneratorSchema = {
    name: 'test-api',
    modelLanguage: 'typespec',
    infrastructureLanguage: 'typescript',
    handlerLanguages: ['typescript'],
    runtimeLanguages: ['typescript'],
    libraries: ['typescript-react-hooks'],
  };

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('should generate the overarching project structure', async () => {
    await typeSafeRestApiGenerator(tree, options);

    // Verify model files are generated
    expect(tree.exists('test-api/model')).toBeTruthy();

    // Verify runtime files are generated
    expect(tree.exists('test-api/generated/runtime/typescript')).toBeTruthy();

    // Verify infrastructure files are generated
    expect(tree.exists('test-api/generated/infrastructure/typescript')).toBeTruthy();

    // Verify handler files are generated
    expect(tree.exists('test-api/handlers/typescript')).toBeTruthy();

    // Verify library files are generated
    expect(tree.exists('test-api/generated/libraries/typescript-react-hooks')).toBeTruthy();
  });

  it('should generate a shared construct for deploying the API', async () => {
    await typeSafeRestApiGenerator(tree, options);

    // Check if shared construct files exist
    expect(tree.exists('packages/common/constructs/src/test-api/index.ts')).toBeTruthy();

    // Verify the shared construct content matches snapshots
    expect(
      tree.read('packages/common/constructs/src/test-api/index.ts')?.toString()
    ).toMatchSnapshot();

    // Verify the construct is exported from common constructs index
    const commonConstructsIndex = tree.read('packages/common/constructs/src/index.ts')?.toString();
    expect(commonConstructsIndex).toContain("export * from './test-api/index.js';");
  });

  it('should generate files with OpenAPI model language', async () => {
    const openApiOptions = {
      ...options,
      modelLanguage: 'openapi' as const,
    };

    await typeSafeRestApiGenerator(tree, openApiOptions);

    expect(tree.exists('test-api/model/src/main.yaml')).toBeTruthy();
  });

  it('should generate files with TypeSpec model language', async () => {
    const typeSpecOptions = {
      ...options,
      modelLanguage: 'typespec' as const,
    };

    await typeSafeRestApiGenerator(tree, typeSpecOptions);

    expect(tree.exists('test-api/model/src/main.tsp')).toBeTruthy();
  });

  it('should throw error for unsupported model language', async () => {
    const invalidOptions = {
      ...options,
      modelLanguage: 'invalid' as any,
    };

    await expect(
      async () => await typeSafeRestApiGenerator(tree, invalidOptions)
    ).rejects.toThrow('Model language invalid is not supported!');
  });

  it('should throw error for unsupported runtime language', async () => {
    const invalidOptions = {
      ...options,
      runtimeLanguages: ['invalid' as any],
    };

    await expect(
      async () => await typeSafeRestApiGenerator(tree, invalidOptions)
    ).rejects.toThrow('Runtime language invalid is not supported!');
  });

  it('should throw error for unsupported handler language', async () => {
    const invalidOptions = {
      ...options,
      handlerLanguages: ['invalid' as any],
    };

    await expect(
      async () => await typeSafeRestApiGenerator(tree, invalidOptions)
    ).rejects.toThrow('Handler language invalid is not supported!');
  });

  it('should throw error for unsupported infrastructure language', async () => {
    const invalidOptions = {
      ...options,
      infrastructureLanguage: 'invalid' as any,
    };

    await expect(
      async () => await typeSafeRestApiGenerator(tree, invalidOptions)
    ).rejects.toThrow('Infrastructure language invalid is not supported!');
  });

  it('should throw error for unsupported library', async () => {
    const invalidOptions = {
      ...options,
      libraries: ['invalid' as any],
    };

    await expect(
      async () => await typeSafeRestApiGenerator(tree, invalidOptions)
    ).rejects.toThrow('Library invalid is not supported!');
  });

  it('should use custom directory when provided', async () => {
    const optionsWithDir = {
      ...options,
      directory: 'custom-dir',
    };

    await typeSafeRestApiGenerator(tree, optionsWithDir);

    expect(tree.exists('custom-dir/test-api/model')).toBeTruthy();
  });

  it('should use custom subdirectory when provided', async () => {
    const optionsWithSubDir = {
      ...options,
      subDirectory: 'sub-dir',
    };

    await typeSafeRestApiGenerator(tree, optionsWithSubDir);

    expect(tree.exists('sub-dir/model')).toBeTruthy();
  });

  it('should use scope when provided', async () => {
    const optionsWithScope = {
      ...options,
      scope: '@test-scope',
    };

    await typeSafeRestApiGenerator(tree, optionsWithScope);

    // Verify files are generated with scoped package names
    expect(tree.exists('test-api/model')).toBeTruthy();

    // Verify project.json contains scoped package names
    const projectJson = JSON.parse(tree.read('test-api/generated/runtime/typescript/project.json').toString());
    expect(projectJson.name).toBe('@test-scope/test-api-runtime-typescript');

    // Verify infrastructure project uses scoped name
    const infrastructureProjectJson = JSON.parse(tree.read('test-api/generated/infrastructure/typescript/project.json').toString());
    expect(infrastructureProjectJson.name).toBe('@test-scope/test-api-infrastructure-typescript');

    // Verify handlers project uses scoped name
    const handlersProjectJson = JSON.parse(tree.read('test-api/handlers/typescript/project.json').toString());
    expect(handlersProjectJson.name).toBe('@test-scope/test-api-handlers-typescript');

    // Verify library project uses scoped name
    const libraryProjectJson = JSON.parse(tree.read('test-api/generated/libraries/typescript-react-hooks/project.json').toString());
    expect(libraryProjectJson.name).toBe('@test-scope/test-api-typescript-react-hooks');

    // Verify shared constructs import uses scoped package name
    const sharedConstructsContent = tree.read('packages/common/constructs/src/test-api/index.ts').toString();
    expect(sharedConstructsContent).toContain("from ':test-scope/test-api-infrastructure-typescript'");
  });

  it('should add required dependencies', async () => {
    await typeSafeRestApiGenerator(tree, options);

    const packageJson = JSON.parse(tree.read('package.json').toString());

    expect(packageJson.dependencies).toMatchObject({
      'constructs': expect.any(String),
      'aws-cdk-lib': expect.any(String),
    });
  });

  it('should not regenerate existing directories', async () => {
    // First run to create files
    await typeSafeRestApiGenerator(tree, options);

    // Create a marker file to detect if regeneration occurs
    tree.write('test-api/model/marker.txt', 'original content');

    // Run generator again
    await typeSafeRestApiGenerator(tree, options);

    // Verify marker file still exists with original content
    expect(tree.read('test-api/model/marker.txt').toString()).toBe('original content');
  });
});
