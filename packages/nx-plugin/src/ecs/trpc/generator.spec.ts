/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readProjectConfiguration, Tree } from '@nx/devkit';
import { ECS_TRPC_GENERATOR_INFO, tsEcsTrpcApiGenerator } from './generator';
import {
  createTreeUsingTsSolutionSetup,
  snapshotTreeDir,
} from '../../utils/test';
import { expectHasMetricTags } from '../../utils/metrics.spec';

describe('ecs trpc generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should generate the project', async () => {
    await tsEcsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    expect(tree.exists('apps/test-api')).toBeTruthy();
    expect(tree.exists('apps/test-api/src/index.ts')).toBeTruthy();
    expect(tree.exists('apps/test-api/src/server.ts')).toBeTruthy();
    expect(tree.exists('apps/test-api/src/local-server.ts')).toBeTruthy();
    expect(tree.exists('apps/test-api/src/router.ts')).toBeTruthy();
    expect(tree.exists('apps/test-api/src/init.ts')).toBeTruthy();
    expect(tree.exists('apps/test-api/src/procedures/echo.ts')).toBeTruthy();
    expect(tree.exists('apps/test-api/src/schema/echo.ts')).toBeTruthy();
    expect(tree.exists('apps/test-api/Dockerfile')).toBeTruthy();

    snapshotTreeDir(tree, 'apps/test-api/src');
    snapshotTreeDir(tree, 'apps/test-api/Dockerfile');
  });

  it('should set up project configuration correctly', async () => {
    await tsEcsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    const backendProjectConfig = JSON.parse(
      tree.read('apps/test-api/project.json', 'utf-8')!,
    );

    expect(backendProjectConfig.metadata).toEqual({
      apiName: 'TestApi',
      apiType: 'ecs-trpc',
      auth: 'IAM',
      generator: ECS_TRPC_GENERATOR_INFO.id,
      port: 3000,
      ports: [3000],
    });
  });

  it('should add required dependencies', async () => {
    await tsEcsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    const packageJson = JSON.parse(tree.read('package.json', 'utf-8')!);

    expect(packageJson.dependencies['@trpc/server']).toBeDefined();
    expect(packageJson.dependencies['@trpc/client']).toBeDefined();
    expect(packageJson.dependencies['zod']).toBeDefined();
    expect(packageJson.dependencies['fastify']).toBeDefined();
    expect(packageJson.dependencies['aws-cdk-lib']).toBeDefined();
    expect(packageJson.dependencies['constructs']).toBeDefined();
    expect(packageJson.devDependencies['tsx']).toBeDefined();
  });

  it('should add a serve target', async () => {
    await tsEcsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    const projectConfig = readProjectConfiguration(tree, '@proj/test-api');
    expect(projectConfig.targets).toHaveProperty('serve');
    expect(projectConfig.targets!.serve!.executor).toBe('nx:run-commands');
    expect(projectConfig.targets!.serve!.options!.commands).toEqual([
      'tsx --watch src/local-server.ts',
    ]);
  });

  it('should add generator metric', async () => {
    await tsEcsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    expectHasMetricTags(tree, ECS_TRPC_GENERATOR_INFO.metric);
  });

  it('should increment ports when running generator multiple times', async () => {
    await tsEcsTrpcApiGenerator(tree, {
      name: 'FirstApi',
      directory: 'apps',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    await tsEcsTrpcApiGenerator(tree, {
      name: 'SecondApi',
      directory: 'apps',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    const firstApiConfig = JSON.parse(
      tree.read('apps/first-api/project.json', 'utf-8')!,
    );
    const secondApiConfig = JSON.parse(
      tree.read('apps/second-api/project.json', 'utf-8')!,
    );

    expect(firstApiConfig.metadata.ports).toEqual([3000]);
    expect(secondApiConfig.metadata.ports).toEqual([3001]);

    const firstServer = tree.read(
      'apps/first-api/src/local-server.ts',
      'utf-8',
    );
    const secondServer = tree.read(
      'apps/second-api/src/local-server.ts',
      'utf-8',
    );

    expect(firstServer).toContain('const PORT = 3000;');
    expect(secondServer).toContain('const PORT = 3001;');
  });

  it('should generate a Dockerfile with the correct port', async () => {
    await tsEcsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    const dockerfile = tree.read('apps/test-api/Dockerfile', 'utf-8');
    expect(dockerfile).toContain('EXPOSE 3000');
    expect(dockerfile).toContain('node:22-slim');
  });

  it('should use fastify adapter in server.ts', async () => {
    await tsEcsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    const serverContent = tree.read('apps/test-api/src/server.ts', 'utf-8');
    expect(serverContent).toContain('fastifyTRPCPlugin');
    expect(serverContent).toContain("from 'fastify'");
    expect(serverContent).toContain('/health');
  });

  it('should set up shared constructs with ECS infra', async () => {
    await tsEcsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    expect(
      tree.exists('packages/common/constructs/src/app/ecs-apis/index.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('packages/common/constructs/src/app/ecs-apis/test-api.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('packages/common/constructs/src/core/ecs/ecs-api.ts'),
    ).toBeTruthy();

    expect(
      tree.read(
        'packages/common/constructs/src/app/ecs-apis/index.ts',
        'utf-8',
      ),
    ).toContain("export * from './test-api.js'");
    expect(
      tree.read('packages/common/constructs/src/app/index.ts', 'utf-8'),
    ).toContain("export * from './ecs-apis/index.js'");
  });

  it('should generate with IAM auth', async () => {
    await tsEcsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    const appApiContent = tree.read(
      'packages/common/constructs/src/app/ecs-apis/test-api.ts',
      'utf-8',
    );
    expect(appApiContent).toContain('HttpIamAuthorizer');
    expect(appApiContent).toContain('grantInvokeAccess');

    snapshotTreeDir(
      tree,
      'packages/common/constructs/src/app/ecs-apis/test-api.ts',
    );
  });

  it('should generate with Cognito auth', async () => {
    await tsEcsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      auth: 'Cognito',
      iacProvider: 'CDK',
    });

    const appApiContent = tree.read(
      'packages/common/constructs/src/app/ecs-apis/test-api.ts',
      'utf-8',
    );
    expect(appApiContent).toContain('HttpUserPoolAuthorizer');

    snapshotTreeDir(
      tree,
      'packages/common/constructs/src/app/ecs-apis/test-api.ts',
    );
  });

  it('should generate with no auth', async () => {
    await tsEcsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      auth: 'None',
      iacProvider: 'CDK',
    });

    const appApiContent = tree.read(
      'packages/common/constructs/src/app/ecs-apis/test-api.ts',
      'utf-8',
    );
    expect(appApiContent).toContain('HttpNoneAuthorizer');

    snapshotTreeDir(
      tree,
      'packages/common/constructs/src/app/ecs-apis/test-api.ts',
    );
  });

  it.each([
    { directory: 'packages', backendRoot: 'packages/test-api' },
    { directory: 'apps', backendRoot: 'apps/test-api' },
  ])(
    'should have consistent Docker build paths when directory=$directory',
    async ({ directory, backendRoot }) => {
      await tsEcsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory,
        auth: 'IAM',
        iacProvider: 'CDK',
      });

      // Verify Dockerfile COPY path references the correct bundle location
      const dockerfile = tree.read(`${backendRoot}/Dockerfile`, 'utf-8');
      expect(dockerfile).toContain(
        `COPY dist/${backendRoot}/bundle/index.js ./index.js`,
      );

      // Verify rolldown config outputs to the matching path
      const rolldownConfig = tree.read(
        `${backendRoot}/rolldown.config.ts`,
        'utf-8',
      );
      expect(rolldownConfig).toContain(`dist/${backendRoot}/bundle/index.js`);

      // Verify the construct sets dockerfilePath to the correct Dockerfile
      const constructContent = tree.read(
        'packages/common/constructs/src/app/ecs-apis/test-api.ts',
        'utf-8',
      );
      expect(constructContent).toContain(
        `dockerfilePath: '${backendRoot}/Dockerfile'`,
      );

      // Verify the construct Docker context resolves to workspace root (6 levels up)
      expect(constructContent).toContain(
        "new URL('../../../../../../', import.meta.url)",
      );

      // Verify shared constructs build depends on the API bundle
      const sharedConstructsConfig = JSON.parse(
        tree.read('packages/common/constructs/project.json', 'utf-8')!,
      );
      expect(sharedConstructsConfig.targets.build.dependsOn).toContainEqual(
        `@proj/test-api:bundle`,
      );

      // Verify the API build depends on bundle
      const apiConfig = JSON.parse(
        tree.read(`${backendRoot}/project.json`, 'utf-8')!,
      );
      expect(apiConfig.targets.build.dependsOn).toContain('bundle');

      // Verify the bundle target outputs to the correct location
      expect(apiConfig.targets.bundle.outputs).toEqual([
        `{workspaceRoot}/dist/{projectRoot}/bundle`,
      ]);
    },
  );

  it('should snapshot the core ECS construct', async () => {
    await tsEcsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    expect(
      tree.read('packages/common/constructs/src/core/ecs/ecs-api.ts', 'utf-8'),
    ).toMatchSnapshot('ecs-api.ts');
  });

  it('should generate bundle target with correct rolldown config', async () => {
    await tsEcsTrpcApiGenerator(tree, {
      name: 'DemoEcsApi',
      directory: 'packages',
      auth: 'None',
      iacProvider: 'CDK',
    });

    const rolldownConfig = tree.read(
      'packages/demo-ecs-api/rolldown.config.ts',
      'utf-8',
    );
    expect(rolldownConfig).toMatchSnapshot('rolldown.config.ts');

    // Verify compile outputs are scoped to tsc subdirectory only
    const apiConfig = JSON.parse(
      tree.read('packages/demo-ecs-api/project.json', 'utf-8')!,
    );
    expect(apiConfig.targets.compile.outputs).toEqual([
      '{workspaceRoot}/dist/{projectRoot}/tsc',
    ]);
    // Verify bundle outputs are scoped to bundle subdirectory only
    expect(apiConfig.targets.bundle.outputs).toEqual([
      '{workspaceRoot}/dist/{projectRoot}/bundle',
    ]);
  });
});
