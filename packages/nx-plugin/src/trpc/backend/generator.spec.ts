/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, readProjectConfiguration, Tree } from '@nx/devkit';
import { TRPC_BACKEND_GENERATOR_INFO, tsTrpcApiGenerator } from './generator';
import { TsTrpcApiGeneratorSchema } from './schema';
import {
  createTreeUsingTsSolutionSetup,
  snapshotTreeDir,
} from '../../utils/test';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../../utils/config/utils';

describe('trpc backend generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should generate the project', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
      integrationPattern: 'isolated',
      auth: 'IAM',
      iacProvider: 'CDK',
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
      computeType: 'ServerlessApiGatewayHttpApi',
      integrationPattern: 'isolated',
      auth: 'IAM',
      iacProvider: 'CDK',
    });
    const backendProjectConfig = JSON.parse(
      tree.read('apps/test-api/project.json', 'utf-8'),
    );
    // Verify project metadata
    expect(backendProjectConfig.metadata).toEqual({
      apiName: 'TestApi',
      apiType: 'trpc',
      auth: 'IAM',
      computeType: 'ServerlessApiGatewayHttpApi',
      integrationPattern: 'isolated',
      generator: TRPC_BACKEND_GENERATOR_INFO.id,
      ports: [2022],
    });
  });

  it('should add required dependencies', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
      integrationPattern: 'isolated',
      iacProvider: 'CDK',
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
      auth: 'IAM',
      integrationPattern: 'isolated',
      iacProvider: 'CDK',
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
      auth: 'IAM',
      integrationPattern: 'isolated',
      iacProvider: 'CDK',
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
      auth: 'IAM',
      integrationPattern: 'isolated',
      iacProvider: 'CDK',
    });
    const projectConfig = readProjectConfiguration(tree, '@proj/test-api');
    expect(projectConfig.targets).toHaveProperty('serve');
    expect(projectConfig.targets!.serve!.executor).toBe('nx:run-commands');
    expect(projectConfig.targets!.serve!.options!.commands).toEqual([
      'tsx --watch src/local-server.ts',
    ]);
  });

  it('should add rolldown bundle target', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
      integrationPattern: 'isolated',
      iacProvider: 'CDK',
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
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
      integrationPattern: 'isolated',
      iacProvider: 'CDK',
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
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
      integrationPattern: 'isolated',
      iacProvider: 'CDK',
    });

    const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));

    // Check rolldown dev dependency was added
    expect(packageJson.devDependencies['rolldown']).toBeDefined();
  });

  it('should ensure build target depends on bundle', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
      integrationPattern: 'isolated',
      iacProvider: 'CDK',
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
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    const devDeps = readJson(tree, 'package.json').devDependencies;
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
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    // Verify the metric was added to app.ts
    expectHasMetricTags(tree, TRPC_BACKEND_GENERATOR_INFO.metric);
  });

  it('should include CORS headers in handler.ts when using REST API', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayRestApi',
      auth: 'IAM',
      integrationPattern: 'isolated',
      iacProvider: 'CDK',
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
      computeType: 'ServerlessApiGatewayRestApi',
      auth: 'Cognito',
      integrationPattern: 'isolated',
      iacProvider: 'CDK',
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
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'Cognito',
      integrationPattern: 'isolated',
      iacProvider: 'CDK',
    });
    snapshotTreeDir(tree, 'apps/test-api/src/client');
    snapshotTreeDir(tree, 'packages/common/constructs/src/app/apis');

    expect(
      tree.read('packages/common/constructs/src/app/apis/test-api.ts', 'utf-8'),
    ).toContain('HttpUserPoolAuthorizer');
  });

  it('should generate with no auth for a REST API', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayRestApi',
      auth: 'None',
      integrationPattern: 'isolated',
      iacProvider: 'CDK',
    });
    snapshotTreeDir(tree, 'apps/test-api/src/client');
    snapshotTreeDir(tree, 'packages/common/constructs/src/app/apis');

    expect(
      tree.read('packages/common/constructs/src/app/apis/test-api.ts', 'utf-8'),
    ).toContain('AuthorizationType.NONE');
  });

  it('should generate with no auth for an HTTP API', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'None',
      integrationPattern: 'isolated',
      iacProvider: 'CDK',
    });
    snapshotTreeDir(tree, 'apps/test-api/src/client');
    snapshotTreeDir(tree, 'packages/common/constructs/src/app/apis');

    expect(
      tree.read('packages/common/constructs/src/app/apis/test-api.ts', 'utf-8'),
    ).toContain('HttpNoneAuthorizer');
  });

  it('should generate a single router lambda for REST APIs when using the shared integration pattern', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayRestApi',
      auth: 'IAM',
      integrationPattern: 'shared',
      iacProvider: 'CDK',
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
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
      integrationPattern: 'shared',
      iacProvider: 'CDK',
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
        computeType:
          'ApplicationLoadBalancedFargateService' as TsTrpcApiGeneratorSchema['computeType'],
        auth: 'IAM',
        integrationPattern: 'isolated',
        iacProvider: 'CDK',
      }),
    ).rejects.toThrow(
      'Invalid tRPC computeType/integrationPattern combination: ApplicationLoadBalancedFargateService + isolated.',
    );

    expect(tree.exists('apps/test-api')).toBeFalsy();
  });

  it('should increment ports when running generator multiple times', async () => {
    // Generate first API
    await tsTrpcApiGenerator(tree, {
      name: 'FirstApi',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    // Generate second API
    await tsTrpcApiGenerator(tree, {
      name: 'SecondApi',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    // Generate third API
    await tsTrpcApiGenerator(tree, {
      name: 'ThirdApi',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
      iacProvider: 'CDK',
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

  describe('terraform iacProvider', () => {
    it('should generate terraform files for HTTP API with IAM auth and snapshot them', async () => {
      await tsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory: 'apps',
        computeType: 'ServerlessApiGatewayHttpApi',
        auth: 'IAM',
        iacProvider: 'Terraform',
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
      expect(appApiContent).toMatch(/runtime\s+=\s+"nodejs22\.x"/);

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
        computeType: 'ServerlessApiGatewayHttpApi',
        auth: 'Cognito',
        iacProvider: 'Terraform',
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
      expect(appApiContent).toMatch(/runtime\s+=\s+"nodejs22\.x"/);

      // Snapshot terraform files
      const terraformFileContents = {
        'http-api.tf': coreApiContent,
        'test-api.tf': appApiContent,
      };

      expect(terraformFileContents).toMatchSnapshot(
        'terraform-http-cognito-files',
      );
    });

    it('should generate terraform files for HTTP API with None auth and snapshot them', async () => {
      await tsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory: 'apps',
        computeType: 'ServerlessApiGatewayHttpApi',
        auth: 'None',
        iacProvider: 'Terraform',
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

      // Verify None auth configuration
      expect(appApiContent).toContain('authorization_type = "NONE"');
      expect(appApiContent).not.toContain('variable "user_pool_id"');

      // Verify tRPC-specific handler configuration
      expect(appApiContent).toMatch(/handler\s+=\s+"index\.handler"/);
      expect(appApiContent).toMatch(/runtime\s+=\s+"nodejs22\.x"/);

      // Snapshot terraform files
      const terraformFileContents = {
        'http-api.tf': coreApiContent,
        'test-api.tf': appApiContent,
      };

      expect(terraformFileContents).toMatchSnapshot(
        'terraform-http-none-files',
      );
    });

    it('should generate terraform files for REST API with IAM auth and snapshot them', async () => {
      await tsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory: 'apps',
        computeType: 'ServerlessApiGatewayRestApi',
        auth: 'IAM',
        iacProvider: 'Terraform',
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
      expect(appApiContent).toMatch(/runtime\s+=\s+"nodejs22\.x"/);

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
        computeType: 'ServerlessApiGatewayRestApi',
        auth: 'Cognito',
        iacProvider: 'Terraform',
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
      expect(appApiContent).toMatch(/runtime\s+=\s+"nodejs22\.x"/);

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
        computeType: 'ServerlessApiGatewayRestApi',
        auth: 'None',
        iacProvider: 'Terraform',
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
      expect(appApiContent).toMatch(/runtime\s+=\s+"nodejs22\.x"/);

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
        computeType: 'ServerlessApiGatewayHttpApi',
        auth: 'IAM',
        iacProvider: 'Terraform',
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
        computeType: 'ServerlessApiGatewayHttpApi',
        auth: 'IAM',
        iacProvider: 'Terraform',
      });

      // Verify CDK files are NOT created
      expect(
        tree.exists('packages/common/constructs/src/app/apis/test-api.ts'),
      ).toBeFalsy();
      expect(
        tree.exists('packages/common/constructs/src/core/api/http-api.ts'),
      ).toBeFalsy();
    });

    it('should throw error for invalid iacProvider', async () => {
      await expect(
        tsTrpcApiGenerator(tree, {
          name: 'TestApi',
          directory: 'apps',
          computeType: 'ServerlessApiGatewayHttpApi',
          auth: 'IAM',
          iacProvider: 'InvalidProvider' as any,
        }),
      ).rejects.toThrow('Unsupported iacProvider InvalidProvider');
    });

    it('should handle terraform with different directory structures', async () => {
      await tsTrpcApiGenerator(tree, {
        name: 'NestedApi',
        directory: 'apps/nested/path',
        computeType: 'ServerlessApiGatewayRestApi',
        auth: 'Cognito',
        iacProvider: 'Terraform',
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

    it('should inherit iacProvider from config when set to Inherit', async () => {
      // Set up config with Terraform provider using utility methods
      await ensureAwsNxPluginConfig(tree);
      await updateAwsNxPluginConfig(tree, {
        iac: {
          provider: 'Terraform',
        },
      });

      await tsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory: 'apps',
        computeType: 'ServerlessApiGatewayHttpApi',
        auth: 'IAM',
        iacProvider: 'Inherit',
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
  });

  it('should place project in subDirectory when provided', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'packages',
      subDirectory: 'apis',
      computeType: 'ServerlessApiGatewayHttpApi',
      integrationPattern: 'isolated',
      auth: 'IAM',
      iacProvider: 'CDK',
    });
    expect(tree.exists('packages/apis')).toBeTruthy();
    expect(tree.exists('packages/apis/src')).toBeTruthy();
    expect(tree.exists('packages/apis/src/index.ts')).toBeTruthy();
  });

  describe('EcsFargate computeType', () => {
    it('should generate the project', async () => {
      await tsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory: 'apps',
        computeType: 'EcsFargate',
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
      await tsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory: 'apps',
        computeType: 'EcsFargate',
        auth: 'IAM',
        iacProvider: 'CDK',
      });

      const backendProjectConfig = JSON.parse(
        tree.read('apps/test-api/project.json', 'utf-8')!,
      );

      expect(backendProjectConfig.metadata).toEqual({
        apiName: 'TestApi',
        apiType: 'trpc',
        auth: 'IAM',
        computeType: 'EcsFargate',
        generator: TRPC_BACKEND_GENERATOR_INFO.id,
        port: 3000,
        ports: [3000],
      });
    });

    it('should add required dependencies', async () => {
      await tsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory: 'apps',
        computeType: 'EcsFargate',
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
      await tsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory: 'apps',
        computeType: 'EcsFargate',
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
      await tsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory: 'apps',
        computeType: 'EcsFargate',
        auth: 'IAM',
        iacProvider: 'CDK',
      });

      expectHasMetricTags(tree, TRPC_BACKEND_GENERATOR_INFO.metric);
    });

    it('should increment ports when running generator multiple times', async () => {
      await tsTrpcApiGenerator(tree, {
        name: 'FirstApi',
        directory: 'apps',
        computeType: 'EcsFargate',
        auth: 'IAM',
        iacProvider: 'CDK',
      });

      await tsTrpcApiGenerator(tree, {
        name: 'SecondApi',
        directory: 'apps',
        computeType: 'EcsFargate',
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
      await tsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory: 'apps',
        computeType: 'EcsFargate',
        auth: 'IAM',
        iacProvider: 'CDK',
      });

      const dockerfile = tree.read('apps/test-api/Dockerfile', 'utf-8');
      expect(dockerfile).toContain('EXPOSE 3000');
      expect(dockerfile).toContain('node:22-slim');
    });

    it('should use fastify adapter in server.ts', async () => {
      await tsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory: 'apps',
        computeType: 'EcsFargate',
        auth: 'IAM',
        iacProvider: 'CDK',
      });

      const serverContent = tree.read('apps/test-api/src/server.ts', 'utf-8');
      expect(serverContent).toContain('fastifyTRPCPlugin');
      expect(serverContent).toContain("from 'fastify'");
      expect(serverContent).toContain('/health');
    });

    it('should set up shared constructs with ECS infra', async () => {
      await tsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory: 'apps',
        computeType: 'EcsFargate',
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
      await tsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory: 'apps',
        computeType: 'EcsFargate',
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
      await tsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory: 'apps',
        computeType: 'EcsFargate',
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
      await tsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory: 'apps',
        computeType: 'EcsFargate',
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
        await tsTrpcApiGenerator(tree, {
          name: 'TestApi',
          directory,
          computeType: 'EcsFargate',
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
      await tsTrpcApiGenerator(tree, {
        name: 'TestApi',
        directory: 'apps',
        computeType: 'EcsFargate',
        auth: 'IAM',
        iacProvider: 'CDK',
      });

      expect(
        tree.read(
          'packages/common/constructs/src/core/ecs/ecs-api.ts',
          'utf-8',
        ),
      ).toMatchSnapshot('ecs-api.ts');
    });

    it('should generate bundle target with correct rolldown config', async () => {
      await tsTrpcApiGenerator(tree, {
        name: 'DemoEcsApi',
        directory: 'packages',
        computeType: 'EcsFargate',
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

    it('should throw for unsupported integration pattern', async () => {
      await expect(
        tsTrpcApiGenerator(tree, {
          name: 'TestApi',
          directory: 'apps',
          computeType: 'EcsFargate',
          auth: 'IAM',
          integrationPattern: 'shared',
          iacProvider: 'CDK',
        }),
      ).rejects.toThrow(
        'Invalid tRPC computeType/integrationPattern combination: EcsFargate + shared.',
      );

      expect(tree.exists('apps/test-api')).toBeFalsy();
    });
  });
});
