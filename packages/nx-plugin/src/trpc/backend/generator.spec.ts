/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, readProjectConfiguration, type Tree } from '@nx/devkit';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../../utils/config/utils.js';
import { expectHasMetricTags } from '../../utils/metrics.spec.js';
import {
  createTreeUsingTsSolutionSetup,
  snapshotTreeDir,
} from '../../utils/test.js';
import { terraformLambdaRuntime } from '../../utils/versions.js';
import {
  TRPC_BACKEND_GENERATOR_INFO,
  tsTrpcApiGenerator,
} from './generator.js';
import type { TsTrpcApiGeneratorSchema } from './schema';

describe('trpc backend generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should generate the project', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      infra: 'http-lambda',
      integrationPattern: 'isolated',
      auth: 'iam',
      iac: 'cdk',
    });

    // Verify project structure
    expect(tree.exists('apps/test-api')).toBeTruthy();

    // Verify generated files
    expect(tree.exists('apps/test-api/src/index.ts')).toBeTruthy();
    expect(tree.exists('apps/test-api/src/procedures')).toBeTruthy();
    expect(tree.exists('apps/test-api/src/schema')).toBeTruthy();

    // Create snapshots of generated files
    snapshotTreeDir(tree, 'apps/test-api/src');
  });

  it('should set up project configuration correctly', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      infra: 'http-lambda',
      integrationPattern: 'isolated',
      auth: 'iam',
      iac: 'cdk',
    });
    const backendProjectConfig = JSON.parse(
      tree.read('apps/test-api/project.json', 'utf-8'),
    );
    // Verify project metadata
    expect(backendProjectConfig.metadata).toEqual({
      apiName: 'TestApi',
      apiType: 'trpc',
      auth: 'iam',
      infra: 'http-lambda',
      integrationPattern: 'isolated',
      generator: TRPC_BACKEND_GENERATOR_INFO.id,
      ports: [2022],
      // Recorded so the version sync can tell a CDK project from a Terraform one.
      iac: 'cdk',
    });
  });

  it('should add required dependencies', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      integrationPattern: 'isolated',
      iac: 'cdk',
    });
    // The backend project declares its own runtime dependencies (and the
    // @types stub backing its type imports) as catalog references.
    const backendPackageJson = JSON.parse(
      tree.read('apps/test-api/package.json', 'utf-8'),
    );
    expect(backendPackageJson.dependencies['@trpc/server']).toBe('catalog:');
    expect(backendPackageJson.dependencies['zod']).toBe('catalog:');
    expect(backendPackageJson.dependencies['aws-xray-sdk-core']).toBe(
      'catalog:',
    );
    expect(
      backendPackageJson.dependencies['@aws-lambda-powertools/logger'],
    ).toBe('catalog:');
    expect(
      backendPackageJson.dependencies['@aws-lambda-powertools/metrics'],
    ).toBe('catalog:');
    expect(
      backendPackageJson.dependencies['@aws-lambda-powertools/tracer'],
    ).toBe('catalog:');
    expect(backendPackageJson.devDependencies['@types/aws-lambda']).toBe(
      'catalog:',
    );
    // CDK libraries are declared by the shared constructs project.
    const constructsPackageJson = JSON.parse(
      tree.read('packages/common/constructs/package.json', 'utf-8'),
    );
    expect(constructsPackageJson.dependencies['aws-cdk-lib']).toBe('catalog:');
    expect(constructsPackageJson.dependencies['constructs']).toBe('catalog:');
  });

  it('should set up shared constructs for http', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      integrationPattern: 'isolated',
      iac: 'cdk',
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
      infra: 'rest-lambda',
      auth: 'iam',
      integrationPattern: 'isolated',
      iac: 'cdk',
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
      infra: 'http-lambda',
      auth: 'iam',
      integrationPattern: 'isolated',
      iac: 'cdk',
    });
    const projectConfig = readProjectConfiguration(tree, '@proj/test-api');
    expect(projectConfig.targets).toHaveProperty('serve');
    expect(projectConfig.targets!.serve!.executor).toBe('nx:run-commands');
    expect(projectConfig.targets!.serve!.options!.commands).toEqual([
      'tsx --watch src/local-server.ts',
    ]);
    expect(projectConfig.targets).toHaveProperty('dev');
    expect(projectConfig.targets!['dev']!.executor).toBe('nx:run-commands');
    expect(projectConfig.targets!['dev']!.options!.commands).toEqual([
      'tsx --watch src/local-server.ts',
    ]);
    expect(projectConfig.targets!['dev']!.options!.env).toEqual({
      LOCAL_DEV: 'true',
    });

    // dev is the local runner
    expect(projectConfig.targets!.dev!.continuous).toBe(true);
  });

  it('should preserve dev dependsOn added by connection generators when re-run', async () => {
    const options: TsTrpcApiGeneratorSchema = {
      name: 'TestApi',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      integrationPattern: 'isolated',
      iac: 'cdk',
    };

    await tsTrpcApiGenerator(tree, options);

    // Simulate a connection generator adding a dependsOn to dev
    const projectConfig = readProjectConfiguration(tree, '@proj/test-api');
    projectConfig.targets!['dev']!.dependsOn = [
      {
        projects: ['@proj/my-table'],
        target: 'dev',
      },
    ];
    const { updateProjectConfiguration } = await import('@nx/devkit');
    updateProjectConfiguration(tree, '@proj/test-api', projectConfig);

    // Re-run the generator
    await tsTrpcApiGenerator(tree, options);

    const updatedConfig = readProjectConfiguration(tree, '@proj/test-api');
    expect(updatedConfig.targets!['dev']!.dependsOn).toEqual([
      {
        projects: ['@proj/my-table'],
        target: 'dev',
      },
    ]);
  });

  it('should add rolldown bundle target', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      integrationPattern: 'isolated',
      iac: 'cdk',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test-api/project.json', 'utf-8'),
    );

    // Check bundle target
    expect(projectConfig.targets['bundle']).toBeDefined();
    const bundleTarget = projectConfig.targets['bundle'];

    expect(bundleTarget.cache).toBe(true);
    expect(bundleTarget.executor).toBe('nx:run-commands');
    expect(bundleTarget.outputs).toEqual([
      '{workspaceRoot}/dist/{projectRoot}/bundle',
    ]);
    expect(bundleTarget.dependsOn).toEqual(['compile']);

    // Check the rolldown command
    expect(bundleTarget.options.command).toBe('rolldown -c rolldown.config.ts');
    expect(bundleTarget.options.cwd).toBe('{projectRoot}');
  });

  it('should create rolldown config file', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      integrationPattern: 'isolated',
      iac: 'cdk',
    });

    // Check rolldown config file was created
    expect(tree.exists('apps/test-api/rolldown.config.ts')).toBeTruthy();

    const rolldownConfig = tree.read(
      'apps/test-api/rolldown.config.ts',
      'utf-8',
    );
    expect(rolldownConfig).toContain('defineConfig');
    expect(rolldownConfig).toContain('src/handler.ts');
    expect(rolldownConfig).toContain(
      '../../dist/apps/test-api/bundle/index.js',
    );

    // AWS SDK is provided by lambda runtime
    expect(rolldownConfig).toContain('external: [/@aws-sdk\\/.*/]');
  });

  it('should add rolldown dependency to package.json', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      integrationPattern: 'isolated',
      iac: 'cdk',
    });

    const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));

    // Check rolldown dev dependency was added
    expect(packageJson.devDependencies['rolldown']).toBeDefined();
  });

  it('should ensure build target depends on bundle', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      integrationPattern: 'isolated',
      iac: 'cdk',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test-api/project.json', 'utf-8'),
    );

    expect(projectConfig.targets.build).toBeDefined();
    expect(projectConfig.targets.build.dependsOn).toContain('bundle');
  });

  it('should add cors headers to the local server', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
    });

    const devDeps = readJson(
      tree,
      'apps/test-api/package.json',
    ).devDependencies;
    expect(devDeps).toHaveProperty('cors');
    expect(devDeps).toHaveProperty('@types/cors');

    expect(tree.exists('apps/test-api/src/local-server.ts')).toBeTruthy();
    expect(tree.read('apps/test-api/src/local-server.ts', 'utf-8')).toContain(
      'middleware: cors()',
    );
  });

  it('should add generator metric to app.ts', async () => {
    // Call the generator function
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
    });

    // Verify the metric was added to app.ts
    expectHasMetricTags(tree, TRPC_BACKEND_GENERATOR_INFO.metric);
  });

  it('should include CORS headers in handler.ts when using REST API', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      infra: 'rest-lambda',
      auth: 'iam',
      integrationPattern: 'isolated',
      iac: 'cdk',
    });

    // Read the generated handler.ts file
    const handlerTsContent = tree.read('apps/test-api/src/handler.ts', 'utf-8');

    // Verify CORS headers are included in responseMeta
    expect(handlerTsContent).toContain('responseMeta: ({ ctx }) => ({');
    expect(handlerTsContent).toContain("'Access-Control-Allow-Origin':");
    expect(handlerTsContent).toContain("'Access-Control-Allow-Methods': '*'");

    // Verify streaming handler is used
    expect(handlerTsContent).toContain('awsLambdaStreamingRequestHandler');
    expect(handlerTsContent).toContain('streamifyResponse');
    expect(handlerTsContent).not.toContain('awsLambdaRequestHandler');

    // Verify router.ts does not contain handler code
    const routerTsContent = tree.read('apps/test-api/src/router.ts', 'utf-8');
    expect(routerTsContent).not.toContain('awsLambdaRequestHandler');

    // Verify z-async-iterable schema helper is generated for REST APIs
    expect(
      tree.exists('apps/test-api/src/schema/z-async-iterable.ts'),
    ).toBeTruthy();
  });

  it('should generate with cognito auth for a REST API', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      infra: 'rest-lambda',
      auth: 'cognito',
      integrationPattern: 'isolated',
      iac: 'cdk',
    });
    snapshotTreeDir(tree, 'apps/test-api/src/client');
    snapshotTreeDir(tree, 'packages/common/constructs/src/app/apis');

    expect(
      tree.read('packages/common/constructs/src/app/apis/test-api.ts', 'utf-8'),
    ).toContain('CognitoUserPoolsAuthorizer');
  });

  it('should generate with cognito auth for an HTTP API', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'cognito',
      integrationPattern: 'isolated',
      iac: 'cdk',
    });
    snapshotTreeDir(tree, 'apps/test-api/src/client');
    snapshotTreeDir(tree, 'packages/common/constructs/src/app/apis');

    expect(
      tree.read('packages/common/constructs/src/app/apis/test-api.ts', 'utf-8'),
    ).toContain('HttpUserPoolAuthorizer');
  });

  it('should generate with custom auth for a REST API', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      infra: 'rest-lambda',
      auth: 'custom',
      integrationPattern: 'isolated',
      iac: 'cdk',
    });
    snapshotTreeDir(tree, 'apps/test-api/src/client');
    snapshotTreeDir(tree, 'packages/common/constructs/src/app/apis');

    expect(
      tree.read('packages/common/constructs/src/app/apis/test-api.ts', 'utf-8'),
    ).toContain('AuthorizationType.CUSTOM');
    expect(tree.exists('apps/test-api/src/authorizer.ts')).toBe(true);
  });

  it('should generate with custom auth for an HTTP API', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'custom',
      integrationPattern: 'isolated',
      iac: 'cdk',
    });
    snapshotTreeDir(tree, 'apps/test-api/src/client');
    snapshotTreeDir(tree, 'packages/common/constructs/src/app/apis');

    expect(
      tree.read('packages/common/constructs/src/app/apis/test-api.ts', 'utf-8'),
    ).toContain('HttpLambdaAuthorizer');
    expect(tree.exists('apps/test-api/src/authorizer.ts')).toBe(true);
  });

  // The authorizer result cache TTL must stay aligned across CDK and Terraform,
  // and across HTTP and REST, so the same workspace behaves the same whichever
  // it is generated with. Caching is keyed on the identity source, so the TTL is
  // only meaningful alongside one.
  describe('custom authorizer result cache TTL', () => {
    it.each(['http-lambda', 'rest-lambda'] as const)(
      'should leave the 300s aws-cdk-lib default in place for %s on CDK',
      async (infra) => {
        await tsTrpcApiGenerator(tree, {
          name: 'TestApi',
          directory: 'apps',
          infra,
          auth: 'custom',
          integrationPattern: 'isolated',
          iac: 'cdk',
        });

        const construct = tree.read(
          'packages/common/constructs/src/app/apis/test-api.ts',
          'utf-8',
        );

        // Both HttpLambdaAuthorizer and TokenAuthorizer default resultsCacheTtl
        // to Duration.minutes(5), which is the value we want, so the construct
        // must not override it.
        expect(construct).not.toContain('resultsCacheTtl');
      },
    );

    it('should pin 300s alongside an identity source for HTTP on Terraform', async () => {
      await tsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory: 'apps',
        infra: 'http-lambda',
        auth: 'custom',
        iac: 'terraform',
      });

      const module = tree.read(
        'packages/common/terraform/src/app/apis/test-api/test-api.tf',
        'utf-8',
      );

      expect(module).toMatch(/authorizer_result_ttl_in_seconds\s+=\s+300/);
      // API Gateway keys the cache on the identity sources, and requires at
      // least one for caching to be enabled at all.
      expect(module).toMatch(
        /identity_sources\s+=\s+\["\$request\.header\.Authorization"\]/,
      );
    });

    it('should leave the 300s provider default in place for REST on Terraform', async () => {
      await tsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory: 'apps',
        infra: 'rest-lambda',
        auth: 'custom',
        iac: 'terraform',
      });

      const module = tree.read(
        'packages/common/terraform/src/app/apis/test-api/test-api.tf',
        'utf-8',
      );

      // aws_api_gateway_authorizer defaults authorizer_result_ttl_in_seconds to
      // 300, so the module must not override it.
      expect(module).not.toContain('authorizer_result_ttl_in_seconds');
      expect(module).toMatch(
        /identity_source\s+=\s+"method\.request\.header\.Authorization"/,
      );
    });
  });

  it('should generate a single router lambda for REST APIs when using the shared integration pattern', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      infra: 'rest-lambda',
      auth: 'iam',
      integrationPattern: 'shared',
      iac: 'cdk',
    });

    const appApiContent = tree.read(
      'packages/common/constructs/src/app/apis/test-api.ts',
      'utf-8',
    );
    const projectConfig = JSON.parse(
      tree.read('apps/test-api/project.json', 'utf-8'),
    );

    expect(projectConfig.metadata.integrationPattern).toBe('shared');
    expect(appApiContent).toContain("pattern: 'shared'");
    expect(appApiContent).toContain(
      'new Function(scope, `TestApi${op}Handler`, props)',
    );
    expect(appApiContent).toContain('scopePermissionToMethod: false');
  });

  it('should generate a single router lambda for HTTP APIs when using the shared integration pattern', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      integrationPattern: 'shared',
      iac: 'cdk',
    });

    const appApiContent = tree.read(
      'packages/common/constructs/src/app/apis/test-api.ts',
      'utf-8',
    );

    expect(appApiContent).toContain("pattern: 'shared'");
    expect(appApiContent).toContain(
      'new Function(scope, `TestApi${op}Handler`, props)',
    );
    expect(appApiContent).toContain('new HttpLambdaIntegration(');
    expect(appApiContent).toContain('`TestApiRouter${op}Integration`');
    expect(appApiContent).toContain('scopePermissionToRoute: false');
  });

  it('should throw for unsupported compute type and integration pattern permutations', async () => {
    await expect(
      tsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory: 'apps',
        infra:
          'ApplicationLoadBalancedFargateService' as TsTrpcApiGeneratorSchema['infra'],
        auth: 'iam',
        integrationPattern: 'isolated',
        iac: 'cdk',
      }),
    ).rejects.toThrow(
      'Invalid tRPC infra/integrationPattern combination: ApplicationLoadBalancedFargateService + isolated.',
    );

    expect(tree.exists('apps/test-api')).toBeFalsy();
  });

  it('should increment ports when running generator multiple times', async () => {
    // Generate first API
    await tsTrpcApiGenerator(tree, {
      name: 'FirstApi',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
    });

    // Generate second API
    await tsTrpcApiGenerator(tree, {
      name: 'SecondApi',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
    });

    // Generate third API
    await tsTrpcApiGenerator(tree, {
      name: 'ThirdApi',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
    });

    // Check metadata ports
    const firstApiConfig = JSON.parse(
      tree.read('apps/first-api/project.json', 'utf-8'),
    );
    const secondApiConfig = JSON.parse(
      tree.read('apps/second-api/project.json', 'utf-8'),
    );
    const thirdApiConfig = JSON.parse(
      tree.read('apps/third-api/project.json', 'utf-8'),
    );

    expect(firstApiConfig.metadata.ports).toEqual([2022]);
    expect(secondApiConfig.metadata.ports).toEqual([2023]);
    expect(thirdApiConfig.metadata.ports).toEqual([2024]);

    // Check local-server.ts files contain correct ports
    const firstLocalServer = tree.read(
      'apps/first-api/src/local-server.ts',
      'utf-8',
    );
    const secondLocalServer = tree.read(
      'apps/second-api/src/local-server.ts',
      'utf-8',
    );
    const thirdLocalServer = tree.read(
      'apps/third-api/src/local-server.ts',
      'utf-8',
    );

    expect(firstLocalServer).toContain('const PORT = 2022;');
    expect(secondLocalServer).toContain('const PORT = 2023;');
    expect(thirdLocalServer).toContain('const PORT = 2024;');
  });

  describe('terraform iac', () => {
    it('should generate terraform files for HTTP API with IAM auth and snapshot them', async () => {
      await tsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory: 'apps',
        infra: 'http-lambda',
        auth: 'iam',
        iac: 'terraform',
      });

      // Find all terraform files
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );

      // Verify terraform files are created
      expect(terraformFiles.length).toBeGreaterThan(0);

      // Find the specific terraform files
      const coreApiFile = terraformFiles.find((f) => f.includes('http-api'));
      const appApiFile = terraformFiles.find((f) => f.includes('test-api'));

      expect(coreApiFile).toBeDefined();
      expect(appApiFile).toBeDefined();

      // Read terraform file contents
      const coreApiContent = tree.read(coreApiFile!, 'utf-8');
      const appApiContent = tree.read(appApiFile!, 'utf-8');

      // Verify IAM auth configuration
      expect(appApiContent).toContain('authorization_type = "AWS_IAM"');
      expect(appApiContent).not.toContain('variable "user_pool_id"');

      // Verify tRPC-specific handler configuration
      expect(appApiContent).toMatch(/handler\s+=\s+"index\.handler"/);
      expect(appApiContent).toMatch(
        new RegExp(`runtime\\s+=\\s+"${terraformLambdaRuntime('node')}"`),
      );

      // Snapshot terraform files
      const terraformFileContents = {
        'http-api.tf': coreApiContent,
        'test-api.tf': appApiContent,
      };

      expect(terraformFileContents).toMatchSnapshot('terraform-http-iam-files');
    });

    it('should generate terraform files for HTTP API with Cognito auth and snapshot them', async () => {
      await tsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory: 'apps',
        infra: 'http-lambda',
        auth: 'cognito',
        iac: 'terraform',
      });

      // Find all terraform files
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );

      // Verify terraform files are created
      expect(terraformFiles.length).toBeGreaterThan(0);

      // Find the specific terraform files
      const coreApiFile = terraformFiles.find((f) => f.includes('http-api'));
      const appApiFile = terraformFiles.find((f) => f.includes('test-api'));

      expect(coreApiFile).toBeDefined();
      expect(appApiFile).toBeDefined();

      // Read terraform file contents
      const coreApiContent = tree.read(coreApiFile!, 'utf-8');
      const appApiContent = tree.read(appApiFile!, 'utf-8');

      // Verify Cognito auth configuration
      expect(appApiContent).toContain('variable "user_pool_id"');
      expect(appApiContent).toContain('variable "user_pool_client_ids"');
      expect(appApiContent).toContain('authorization_type = "JWT"');

      // Verify tRPC-specific handler configuration
      expect(appApiContent).toMatch(/handler\s+=\s+"index\.handler"/);
      expect(appApiContent).toMatch(
        new RegExp(`runtime\\s+=\\s+"${terraformLambdaRuntime('node')}"`),
      );

      // Snapshot terraform files
      const terraformFileContents = {
        'http-api.tf': coreApiContent,
        'test-api.tf': appApiContent,
      };

      expect(terraformFileContents).toMatchSnapshot(
        'terraform-http-cognito-files',
      );
    });

    it('should generate terraform files for HTTP API with Custom auth and snapshot them', async () => {
      await tsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory: 'apps',
        infra: 'http-lambda',
        auth: 'custom',
        iac: 'terraform',
      });

      // Find all terraform files
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );

      // Verify terraform files are created
      expect(terraformFiles.length).toBeGreaterThan(0);

      // Find the specific terraform files
      const coreApiFile = terraformFiles.find((f) => f.includes('http-api'));
      const appApiFile = terraformFiles.find((f) => f.includes('test-api'));

      expect(coreApiFile).toBeDefined();
      expect(appApiFile).toBeDefined();

      // Read terraform file contents
      const coreApiContent = tree.read(coreApiFile!, 'utf-8');
      const appApiContent = tree.read(appApiFile!, 'utf-8');

      // Verify Custom auth configuration
      expect(appApiContent).toContain('authorization_type = "CUSTOM"');
      expect(appApiContent).not.toContain('variable "user_pool_id"');

      // Verify tRPC-specific handler configuration
      expect(appApiContent).toMatch(/handler\s+=\s+"index\.handler"/);
      expect(appApiContent).toMatch(
        new RegExp(`runtime\\s+=\\s+"${terraformLambdaRuntime('node')}"`),
      );

      // Snapshot terraform files
      const terraformFileContents = {
        'http-api.tf': coreApiContent,
        'test-api.tf': appApiContent,
      };

      expect(terraformFileContents).toMatchSnapshot(
        'terraform-http-custom-files',
      );
    });

    it('should generate terraform files for REST API with IAM auth and snapshot them', async () => {
      await tsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory: 'apps',
        infra: 'rest-lambda',
        auth: 'iam',
        iac: 'terraform',
      });

      // Find all terraform files
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );

      // Verify terraform files are created
      expect(terraformFiles.length).toBeGreaterThan(0);

      // Find the specific terraform files
      const coreApiFile = terraformFiles.find((f) => f.includes('rest-api'));
      const appApiFile = terraformFiles.find((f) => f.includes('test-api'));

      expect(coreApiFile).toBeDefined();
      expect(appApiFile).toBeDefined();

      // Read terraform file contents
      const coreApiContent = tree.read(coreApiFile!, 'utf-8');
      const appApiContent = tree.read(appApiFile!, 'utf-8');

      // Verify IAM auth configuration
      expect(appApiContent).toContain('authorization = "AWS_IAM"');
      expect(appApiContent).not.toContain('variable "user_pool_id"');

      // Verify tRPC-specific handler configuration
      expect(appApiContent).toMatch(/handler\s+=\s+"index\.handler"/);
      expect(appApiContent).toMatch(
        new RegExp(`runtime\\s+=\\s+"${terraformLambdaRuntime('node')}"`),
      );

      // Snapshot terraform files
      const terraformFileContents = {
        'rest-api.tf': coreApiContent,
        'test-api.tf': appApiContent,
      };

      expect(terraformFileContents).toMatchSnapshot('terraform-rest-iam-files');
    });

    it('should generate terraform files for REST API with Cognito auth and snapshot them', async () => {
      await tsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory: 'apps',
        infra: 'rest-lambda',
        auth: 'cognito',
        iac: 'terraform',
      });

      // Find all terraform files
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );

      // Verify terraform files are created
      expect(terraformFiles.length).toBeGreaterThan(0);

      // Find the specific terraform files
      const coreApiFile = terraformFiles.find((f) => f.includes('rest-api'));
      const appApiFile = terraformFiles.find((f) => f.includes('test-api'));

      expect(coreApiFile).toBeDefined();
      expect(appApiFile).toBeDefined();

      // Read terraform file contents
      const coreApiContent = tree.read(coreApiFile!, 'utf-8');
      const appApiContent = tree.read(appApiFile!, 'utf-8');

      // Verify Cognito auth configuration
      expect(appApiContent).toContain('variable "user_pool_id"');
      expect(appApiContent).toContain('variable "user_pool_client_ids"');
      expect(appApiContent).toContain('authorization = "COGNITO_USER_POOLS"');

      // Verify tRPC-specific handler configuration
      expect(appApiContent).toMatch(/handler\s+=\s+"index\.handler"/);
      expect(appApiContent).toMatch(
        new RegExp(`runtime\\s+=\\s+"${terraformLambdaRuntime('node')}"`),
      );

      // Snapshot terraform files
      const terraformFileContents = {
        'rest-api.tf': coreApiContent,
        'test-api.tf': appApiContent,
      };

      expect(terraformFileContents).toMatchSnapshot(
        'terraform-rest-cognito-files',
      );
    });

    it('should generate terraform files for REST API with None auth and snapshot them', async () => {
      await tsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory: 'apps',
        infra: 'rest-lambda',
        auth: 'custom',
        iac: 'terraform',
      });

      // Find all terraform files
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );

      // Verify terraform files are created
      expect(terraformFiles.length).toBeGreaterThan(0);

      // Find the specific terraform files
      const coreApiFile = terraformFiles.find((f) => f.includes('rest-api'));
      const appApiFile = terraformFiles.find((f) => f.includes('test-api'));

      expect(coreApiFile).toBeDefined();
      expect(appApiFile).toBeDefined();

      // Read terraform file contents
      const coreApiContent = tree.read(coreApiFile!, 'utf-8');
      const appApiContent = tree.read(appApiFile!, 'utf-8');

      // Verify None auth configuration
      expect(appApiContent).toContain('authorization = "NONE"');
      expect(appApiContent).not.toContain('variable "user_pool_id"');

      // Verify tRPC-specific handler configuration
      expect(appApiContent).toMatch(/handler\s+=\s+"index\.handler"/);
      expect(appApiContent).toMatch(
        new RegExp(`runtime\\s+=\\s+"${terraformLambdaRuntime('node')}"`),
      );

      // Snapshot terraform files
      const terraformFileContents = {
        'rest-api.tf': coreApiContent,
        'test-api.tf': appApiContent,
      };

      expect(terraformFileContents).toMatchSnapshot(
        'terraform-rest-none-files',
      );
    });

    it('should configure project targets and dependencies correctly for terraform', async () => {
      await tsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory: 'apps',
        infra: 'http-lambda',
        auth: 'iam',
        iac: 'terraform',
      });

      // Check that shared terraform project has build dependency on the API project
      const sharedTerraformConfig = JSON.parse(
        tree.read('packages/common/terraform/project.json', 'utf-8'),
      );

      expect(sharedTerraformConfig.targets.build.dependsOn).toContain(
        '@proj/test-api:build',
      );

      // Verify project configuration doesn't have CDK-specific dependencies
      const projectConfig = JSON.parse(
        tree.read('apps/test-api/project.json', 'utf-8'),
      );

      // Should still have basic tRPC targets
      expect(projectConfig.targets.build).toBeDefined();
      expect(projectConfig.targets.serve).toBeDefined();
    });

    it('should not create CDK constructs when using terraform', async () => {
      await tsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory: 'apps',
        infra: 'http-lambda',
        auth: 'iam',
        iac: 'terraform',
      });

      // Verify CDK files are NOT created
      expect(
        tree.exists('packages/common/constructs/src/app/apis/test-api.ts'),
      ).toBeFalsy();
      expect(
        tree.exists('packages/common/constructs/src/core/api/http-api.ts'),
      ).toBeFalsy();
    });

    it('should throw error for invalid iac', async () => {
      await expect(
        tsTrpcApiGenerator(tree, {
          name: 'TestApi',
          directory: 'apps',
          infra: 'http-lambda',
          auth: 'iam',
          iac: 'InvalidProvider' as any,
        }),
      ).rejects.toThrow('Unsupported iac InvalidProvider');
    });

    it('should handle terraform with different directory structures', async () => {
      await tsTrpcApiGenerator(tree, {
        name: 'NestedApi',
        directory: 'apps/nested/path',
        infra: 'rest-lambda',
        auth: 'cognito',
        iac: 'terraform',
      });

      // Verify terraform files are created
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );

      expect(terraformFiles.length).toBeGreaterThan(0);

      // Find the app-specific terraform file
      const appApiFile = terraformFiles.find((f) => f.includes('nested-api'));
      expect(appApiFile).toBeDefined();

      const terraformContent = tree.read(appApiFile!, 'utf-8');

      // Verify the correct bundle path is used for nested directories
      expect(terraformContent).toContain(
        'dist/apps/nested/path/nested-api/bundle',
      );
      expect(terraformContent).toContain(
        'authorization = "COGNITO_USER_POOLS"',
      );
    });

    it('should inherit iac from config when set to Inherit', async () => {
      // Set up config with Terraform provider using utility methods
      await ensureAwsNxPluginConfig(tree);
      await updateAwsNxPluginConfig(tree, {
        iac: {
          provider: 'terraform',
        },
      });

      await tsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory: 'apps',
        infra: 'http-lambda',
        auth: 'iam',
        iac: 'inherit',
      });

      // Verify Terraform files are created (not CDK constructs)
      expect(tree.exists('packages/common/terraform')).toBeTruthy();
      expect(tree.exists('packages/common/constructs')).toBeFalsy();

      // Find terraform files
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );
      expect(terraformFiles.length).toBeGreaterThan(0);
    });

    it.each(['http-lambda', 'rest-lambda'] as const)(
      'should generate one lambda function per operation for %s with the isolated pattern',
      async (infra) => {
        await tsTrpcApiGenerator(tree, {
          name: 'TestApi',
          directory: 'apps',
          infra,
          auth: 'iam',
          integrationPattern: 'isolated',
          iac: 'terraform',
        });

        const appApiContent = tree.read(
          'packages/common/terraform/src/app/apis/test-api/test-api.tf',
          'utf-8',
        );

        // Operations drive the per-operation resources
        expect(appApiContent).toContain(
          'operations_file = "${path.module}/../../../generated/test-api/operations.json"',
        );
        // One lambda function and execution role per operation
        expect(appApiContent).toMatch(
          /resource "aws_lambda_function" "api_lambda" \{[^}]*for_each = local\.operations/,
        );
        expect(appApiContent).toMatch(
          /resource "aws_iam_role" "lambda_execution_role" \{[^}]*for_each = local\.operations/,
        );
        // The proxy catch-all belongs to the shared pattern only
        expect(appApiContent).not.toContain('{proxy+}');
        expect(appApiContent).not.toContain('/{proxy+}');

        // Outputs are keyed per operation
        expect(appApiContent).toContain('output "lambda_function_names"');
        expect(appApiContent).not.toContain('output "lambda_function_name"');

        // A script/target generates the operations metadata the module reads
        const projectConfig = JSON.parse(
          tree.read('apps/test-api/project.json', 'utf-8'),
        );
        expect(projectConfig.targets.operations).toBeDefined();
        expect(projectConfig.targets.build.dependsOn).toContain('operations');
        expect(
          tree.exists('apps/test-api/scripts/generate-operations.ts'),
        ).toBeTruthy();

        // The shared terraform project must have the file before it is planned
        const terraformConfig = JSON.parse(
          tree.read('packages/common/terraform/project.json', 'utf-8'),
        );
        expect(terraformConfig.targets.build.dependsOn).toContain(
          '@proj/test-api:operations',
        );
      },
    );

    it('should generate a single router lambda with the shared pattern', async () => {
      await tsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory: 'apps',
        infra: 'http-lambda',
        auth: 'iam',
        integrationPattern: 'shared',
        iac: 'terraform',
      });

      const appApiContent = tree.read(
        'packages/common/terraform/src/app/apis/test-api/test-api.tf',
        'utf-8',
      );

      expect(appApiContent).not.toContain('local.operations');
      expect(appApiContent).toContain('/{proxy+}');
      expect(appApiContent).toContain('output "lambda_function_name"');

      // No operations metadata is needed for the shared pattern
      const projectConfig = JSON.parse(
        tree.read('apps/test-api/project.json', 'utf-8'),
      );
      expect(projectConfig.targets.operations).toBeUndefined();
      expect(
        tree.exists('apps/test-api/scripts/generate-operations.ts'),
      ).toBeFalsy();
    });
  });

  it('should place project in subDirectory when provided', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'packages',
      subDirectory: 'apis',
      infra: 'http-lambda',
      integrationPattern: 'isolated',
      auth: 'iam',
      iac: 'cdk',
    });
    expect(tree.exists('packages/apis')).toBeTruthy();
    expect(tree.exists('packages/apis/src')).toBeTruthy();
    expect(tree.exists('packages/apis/src/index.ts')).toBeTruthy();
  });

  it('should generate with infra=none then upgrade to infra=rest-lambda', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'packages',
      infra: 'none',
      integrationPattern: 'isolated',
      auth: 'iam',
      iac: 'cdk',
    });

    expect(tree.exists('packages/test-api/src/router.ts')).toBeTruthy();
    expect(tree.exists('packages/common/constructs')).toBeFalsy();

    const projectJson = JSON.parse(
      tree.read('packages/test-api/project.json', 'utf-8'),
    );
    expect(projectJson.targets['bundle']).toBeUndefined();

    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'packages',
      infra: 'rest-lambda',
      integrationPattern: 'isolated',
      auth: 'iam',
      iac: 'cdk',
    });

    expect(tree.exists('packages/common/constructs')).toBeTruthy();
    const updatedProjectJson = JSON.parse(
      tree.read('packages/test-api/project.json', 'utf-8'),
    );
    expect(updatedProjectJson.targets['bundle']).toBeDefined();
  });

  it('should be idempotent when re-run with same options', async () => {
    const options: TsTrpcApiGeneratorSchema = {
      name: 'TestApi',
      directory: 'apps',
      infra: 'http-lambda',
      integrationPattern: 'isolated',
      auth: 'iam',
      iac: 'cdk',
    };
    await tsTrpcApiGenerator(tree, options);
    const firstProjectJson = tree.read('apps/test-api/project.json', 'utf-8');

    await tsTrpcApiGenerator(tree, options);
    const secondProjectJson = tree.read('apps/test-api/project.json', 'utf-8');

    expect(secondProjectJson).toEqual(firstProjectJson);

    const projectConfig = JSON.parse(secondProjectJson);
    expect(projectConfig.metadata.ports).toEqual([2022]);
  });

  // A project named after the core construct its infrastructure extends used to
  // emit `export class HttpApi ... extends HttpApi` with `HttpApi` imported too.
  describe.each([
    {
      name: 'http-api',
      infra: 'http-lambda' as const,
      coreClass: 'HttpApi',
      corePath: '../../core/api/http-api.js',
    },
    {
      name: 'rest-api',
      infra: 'rest-lambda' as const,
      coreClass: 'RestApi',
      corePath: '../../core/api/rest-api.js',
    },
  ])(
    'a project named $name, colliding with the core $coreClass',
    ({ name, infra, coreClass, corePath }) => {
      it('extends the aliased core construct rather than itself', async () => {
        await tsTrpcApiGenerator(tree, {
          name,
          directory: 'apps',
          infra,
          integrationPattern: 'isolated',
          auth: 'iam',
          iac: 'cdk',
        });

        const construct =
          tree.read(
            `packages/common/constructs/src/app/apis/${name}.ts`,
            'utf-8',
          ) ?? '';

        // The core class is imported under an alias, so the app class of the
        // same name neither collides with nor extends itself.
        expect(construct).toContain(`${coreClass} as Core${coreClass}`);
        expect(construct).toContain(`from '${corePath}'`);
        expect(construct).toContain(`extends Core${coreClass}<`);
        expect(construct).toContain(`export class ${coreClass}<`);
        expect(construct).not.toMatch(
          new RegExp(`import \\{[^}]*\\b${coreClass}\\s*\\}`),
        );
        expect(construct).not.toContain(`extends ${coreClass}<`);
      });

      it('leaves the import unaliased for a name that does not collide', async () => {
        await tsTrpcApiGenerator(tree, {
          name: 'test-api',
          directory: 'apps',
          infra,
          integrationPattern: 'isolated',
          auth: 'iam',
          iac: 'cdk',
        });

        const construct =
          tree.read(
            'packages/common/constructs/src/app/apis/test-api.ts',
            'utf-8',
          ) ?? '';

        // Aliasing is applied only where it is needed, so the vended code for an
        // ordinary name is unchanged.
        expect(construct).toContain(`extends ${coreClass}<`);
        expect(construct).not.toContain(`Core${coreClass}`);
      });
    },
  );
});
