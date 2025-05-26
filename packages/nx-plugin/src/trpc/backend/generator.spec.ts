/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readProjectConfiguration, Tree } from '@nx/devkit';
import { TRPC_BACKEND_GENERATOR_INFO, tsTrpcApiGenerator } from './generator';
import {
  createTreeUsingTsSolutionSetup,
  snapshotTreeDir,
} from '../../utils/test';
import { expectHasMetricTags } from '../../utils/metrics.spec';

describe('trpc backend generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should generate backend and schema projects', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
    });

    // Verify project structure
    expect(tree.exists('apps/test-api/backend')).toBeTruthy();
    expect(tree.exists('apps/test-api/schema')).toBeTruthy();

    // Verify generated files
    expect(tree.exists('apps/test-api/backend/src/index.ts')).toBeTruthy();
    expect(tree.exists('apps/test-api/backend/src/procedures')).toBeTruthy();
    expect(tree.exists('apps/test-api/schema/src/index.ts')).toBeTruthy();

    // Create snapshots of generated files
    snapshotTreeDir(tree, 'apps/test-api/backend/src');
    snapshotTreeDir(tree, 'apps/test-api/schema/src');
  });

  it('should set up project configuration correctly', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
    });
    const backendProjectConfig = JSON.parse(
      tree.read('apps/test-api/backend/project.json', 'utf-8'),
    );
    // Verify project metadata
    expect(backendProjectConfig.metadata).toEqual({
      apiName: 'TestApi',
      apiType: 'trpc',
      generator: TRPC_BACKEND_GENERATOR_INFO.id,
    });
  });

  it('should add required dependencies', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
    });
    const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    // Verify dependencies were added
    expect(packageJson.dependencies['@trpc/server']).toBeDefined();
    expect(packageJson.dependencies['zod']).toBeDefined();
    expect(packageJson.dependencies['aws-xray-sdk-core']).toBeDefined();
    expect(packageJson.dependencies['aws-cdk-lib']).toBeDefined();
    expect(packageJson.dependencies['constructs']).toBeDefined();
    expect(
      packageJson.dependencies['@aws-lambda-powertools/logger'],
    ).toBeDefined();
    expect(
      packageJson.dependencies['@aws-lambda-powertools/metrics'],
    ).toBeDefined();
    expect(
      packageJson.dependencies['@aws-lambda-powertools/tracer'],
    ).toBeDefined();
    expect(packageJson.devDependencies['@types/aws-lambda']).toBeDefined();
  });

  it('should set up shared constructs for http', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
    });
    // Verify shared constructs setup
    expect(
      tree.exists('packages/common/constructs/src/app/apis/index.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('packages/common/constructs/src/app/apis/test-api.ts'),
    ).toBeTruthy();

    expect(
      tree.read('packages/common/constructs/src/app/apis/index.ts', 'utf-8'),
    ).toContain("export * from './test-api.js'");
    expect(
      tree.read('packages/common/constructs/src/app/index.ts', 'utf-8'),
    ).toContain("export * from './apis/index.js'");
    expect(
      tree.read('packages/common/constructs/src/app/apis/test-api.ts', 'utf-8'),
    ).toMatchSnapshot('test-api.ts');
    expect(
      tree.read('packages/common/constructs/src/core/api/http-api.ts', 'utf-8'),
    ).toMatchSnapshot('http-api.ts');
    expect(
      tree.read('packages/common/constructs/src/core/api/utils.ts', 'utf-8'),
    ).toMatchSnapshot('utils.ts');
    expect(
      tree.read(
        'packages/common/constructs/src/core/api/trpc-utils.ts',
        'utf-8',
      ),
    ).toMatchSnapshot('trpc-utils.ts');

    expect(
      tree.exists('packages/common/constructs/src/core/api/rest-api.ts'),
    ).toBeFalsy();
  });

  it('should set up shared constructs for rest', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayRestApi',
    });
    // Verify shared constructs setup
    expect(
      tree.exists('packages/common/constructs/src/app/apis/index.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('packages/common/constructs/src/app/apis/test-api.ts'),
    ).toBeTruthy();

    expect(
      tree.read('packages/common/constructs/src/app/apis/index.ts', 'utf-8'),
    ).toContain("export * from './test-api.js'");
    expect(
      tree.read('packages/common/constructs/src/app/index.ts', 'utf-8'),
    ).toContain("export * from './apis/index.js'");
    expect(
      tree.read('packages/common/constructs/src/app/apis/test-api.ts', 'utf-8'),
    ).toMatchSnapshot('test-api.ts');
    expect(
      tree.read('packages/common/constructs/src/core/api/rest-api.ts', 'utf-8'),
    ).toMatchSnapshot('rest-api.ts');
    expect(
      tree.read('packages/common/constructs/src/core/api/utils.ts', 'utf-8'),
    ).toMatchSnapshot('utils.ts');
    expect(
      tree.read(
        'packages/common/constructs/src/core/api/trpc-utils.ts',
        'utf-8',
      ),
    ).toMatchSnapshot('trpc-utils.ts');

    expect(
      tree.exists('packages/common/constructs/src/core/api/http-api.ts'),
    ).toBeFalsy();
  });

  it('should add a task for starting a local server', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
    });
    const projectConfig = readProjectConfiguration(tree, '@proj/test-api');
    expect(projectConfig.targets).toHaveProperty('serve');
    expect(projectConfig.targets!.serve!.executor).toBe('nx:run-commands');
    expect(projectConfig.targets!.serve!.options!.commands).toEqual([
      'tsx src/local-server.ts',
    ]);
  });

  it('should add generator metric to app.ts', async () => {
    // Call the generator function
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
    });

    // Verify the metric was added to app.ts
    expectHasMetricTags(tree, TRPC_BACKEND_GENERATOR_INFO.metric);
  });

  it('should include CORS headers in router.ts when using REST API', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayRestApi',
    });

    // Read the generated router.ts file
    const routerTsContent = tree.read(
      'apps/test-api/backend/src/router.ts',
      'utf-8',
    );

    // Verify CORS headers are included in responseMeta
    expect(routerTsContent).toContain('responseMeta: () => ({');
    expect(routerTsContent).toContain("'Access-Control-Allow-Origin': '*'");
    expect(routerTsContent).toContain("'Access-Control-Allow-Methods': '*'");
  });
});
