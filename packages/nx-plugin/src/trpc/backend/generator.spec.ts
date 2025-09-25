/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, readProjectConfiguration, Tree } from '@nx/devkit';
import { TRPC_BACKEND_GENERATOR_INFO, tsTrpcApiGenerator } from './generator';
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
      iacProvider: 'CDK',
    });

    // Check rolldown config file was created
    expect(tree.exists('apps/test-api/rolldown.config.ts')).toBeTruthy();

    const rolldownConfig = tree.read(
      'apps/test-api/rolldown.config.ts',
      'utf-8',
    );
    expect(rolldownConfig).toContain('defineConfig');
    expect(rolldownConfig).toContain('src/router.ts');
    expect(rolldownConfig).toContain(
      '../../dist/apps/test-api/bundle/index.js',
    );
  });

  it('should add rolldown dependency to package.json', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
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

  it('should include CORS headers in router.ts when using REST API', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayRestApi',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    // Read the generated router.ts file
    const routerTsContent = tree.read('apps/test-api/src/router.ts', 'utf-8');

    // Verify CORS headers are included in responseMeta
    expect(routerTsContent).toContain('responseMeta: () => ({');
    expect(routerTsContent).toContain("'Access-Control-Allow-Origin': '*'");
    expect(routerTsContent).toContain("'Access-Control-Allow-Methods': '*'");
  });

  it('should generate with cognito auth for a REST API', async () => {
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayRestApi',
      auth: 'Cognito',
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
      iacProvider: 'CDK',
    });
    snapshotTreeDir(tree, 'apps/test-api/src/client');
    snapshotTreeDir(tree, 'packages/common/constructs/src/app/apis');

    expect(
      tree.read('packages/common/constructs/src/app/apis/test-api.ts', 'utf-8'),
    ).toContain('HttpNoneAuthorizer');
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
});
