/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from 'nx/src/devkit-testing-exports';
import { trpcBackendGenerator } from './generator';
describe('trpc backend generator', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });
  it('should generate backend and schema projects', async () => {
    await trpcBackendGenerator(tree, {
      apiName: 'TestApi',
      directory: 'apps',
      unitTestRunner: 'vitest',
      bundler: 'vite',
    });
    // Verify project structure
    expect(tree.exists('apps/test-api/backend')).toBeTruthy();
    expect(tree.exists('apps/test-api/schema')).toBeTruthy();
    // Verify generated files
    expect(tree.exists('apps/test-api/backend/src/index.ts')).toBeTruthy();
    expect(tree.exists('apps/test-api/backend/src/lambdas')).toBeTruthy();
    expect(tree.exists('apps/test-api/schema/src/index.ts')).toBeTruthy();
    // Create snapshots of generated files
    expect(
      tree.read('apps/test-api/backend/src/index.ts', 'utf-8')
    ).toMatchSnapshot('backend-index.ts');
    expect(
      tree.read('apps/test-api/schema/src/index.ts', 'utf-8')
    ).toMatchSnapshot('schema-index.ts');
  });
  it('should set up project configuration correctly', async () => {
    await trpcBackendGenerator(tree, {
      apiName: 'TestApi',
      directory: 'apps',
      unitTestRunner: 'vitest',
      bundler: 'vite',
    });
    const backendProjectConfig = JSON.parse(
      tree.read('apps/test-api/backend/project.json', 'utf-8')
    );
    // Verify project metadata
    expect(backendProjectConfig.metadata).toEqual({
      apiName: 'TestApi',
    });
  });
  it('should add required dependencies', async () => {
    await trpcBackendGenerator(tree, {
      apiName: 'TestApi',
      directory: 'apps',
      unitTestRunner: 'vitest',
      bundler: 'vite',
    });
    const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    // Verify dependencies were added
    expect(packageJson.dependencies['@trpc/server']).toBeDefined();
    expect(packageJson.dependencies['zod']).toBeDefined();
    expect(packageJson.dependencies['aws-xray-sdk-core']).toBeDefined();
    expect(packageJson.dependencies['aws-cdk-lib']).toBeDefined();
    expect(packageJson.dependencies['constructs']).toBeDefined();
    expect(
      packageJson.dependencies['@aws-lambda-powertools/logger']
    ).toBeDefined();
    expect(
      packageJson.dependencies['@aws-lambda-powertools/metrics']
    ).toBeDefined();
    expect(
      packageJson.dependencies['@aws-lambda-powertools/tracer']
    ).toBeDefined();
    expect(packageJson.devDependencies['@types/aws-lambda']).toBeDefined();
  });
  it('should set up shared constructs', async () => {
    await trpcBackendGenerator(tree, {
      apiName: 'TestApi',
      directory: 'apps',
      unitTestRunner: 'vitest',
      bundler: 'vite',
    });
    // Verify shared constructs setup
    expect(
      tree.exists('packages/common/constructs/src/app/trpc-apis/index.ts')
    ).toBeTruthy();
    expect(
      tree.exists('packages/common/constructs/src/app/trpc-apis/test-api.ts')
    ).toBeTruthy();
    // Create snapshot of shared constructs file
    expect(
      tree.read(
        'packages/common/constructs/src/app/trpc-apis/index.ts',
        'utf-8'
      )
    ).toMatchSnapshot('index.ts');
    expect(
      tree.read(
        'packages/common/constructs/src/app/trpc-apis/test-api.ts',
        'utf-8'
      )
    ).toMatchSnapshot('test-api.ts');
    expect(
      tree.read('packages/common/constructs/src/core/trpc-api.ts', 'utf-8')
    ).toMatchSnapshot('trpc-api.ts');
    expect(
      tree.read('packages/common/constructs/src/core/index.ts', 'utf-8')
    ).toContain('./trpc-api.js');
  });
});
