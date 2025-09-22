/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, Tree } from '@nx/devkit';
import {
  tsSmithyApiGenerator,
  TS_SMITHY_API_GENERATOR_INFO,
} from './generator';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import { sharedConstructsGenerator } from '../../../utils/shared-constructs';
import { expectHasMetricTags } from '../../../utils/metrics.spec';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../../../utils/config/utils';

describe('tsSmithyApiGenerator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should generate smithy ts api with default options', async () => {
    await tsSmithyApiGenerator(tree, {
      name: 'test-api',
      computeType: 'ServerlessApiGatewayRestApi',
      auth: 'None',
      iacProvider: 'CDK',
    });

    // Verify model project structure
    expect(tree.exists('test-api/model')).toBeTruthy();
    expect(tree.exists('test-api/model/src')).toBeTruthy();
    expect(tree.exists('test-api/model/src/main.smithy')).toBeTruthy();
    expect(
      tree.exists('test-api/model/src/operations/echo.smithy'),
    ).toBeTruthy();
    expect(tree.exists('test-api/model/build.Dockerfile')).toBeTruthy();
    expect(tree.exists('test-api/model/smithy-build.json')).toBeTruthy();
    expect(tree.exists('test-api/model/project.json')).toBeTruthy();

    // Verify backend project structure
    expect(tree.exists('test-api/backend')).toBeTruthy();
    expect(tree.exists('test-api/backend/src')).toBeTruthy();
    expect(tree.exists('test-api/backend/src/handler.ts')).toBeTruthy();
    expect(tree.exists('test-api/backend/src/local-server.ts')).toBeTruthy();
    expect(tree.exists('test-api/backend/src/service.ts')).toBeTruthy();
    expect(tree.exists('test-api/backend/src/context.ts')).toBeTruthy();
    expect(tree.exists('test-api/backend/src/operations')).toBeTruthy();
    expect(tree.exists('test-api/backend/src/operations/echo.ts')).toBeTruthy();
    expect(tree.exists('test-api/backend/project.json')).toBeTruthy();

    // Verify shared constructs added
    expect(tree.exists('packages/common/constructs')).toBeTruthy();

    // Verify model project configuration
    const modelProjectConfig = readJson(tree, 'test-api/model/project.json');
    expect(modelProjectConfig.name).toBe('@proj/test-api-model');
    expect(modelProjectConfig.metadata.backendProject).toBe('@proj/test-api');

    // Verify backend project configuration
    const backendProjectConfig = readJson(
      tree,
      'test-api/backend/project.json',
    );
    expect(backendProjectConfig.name).toBe('@proj/test-api');
    expect(backendProjectConfig.targets.build).toBeDefined();
    expect(backendProjectConfig.targets.compile).toBeDefined();
    expect(backendProjectConfig.targets.serve).toBeDefined();
    expect(backendProjectConfig.targets['copy-ssdk']).toBeDefined();
    expect(backendProjectConfig.targets['watch-copy-ssdk']).toBeDefined();
    expect(backendProjectConfig.metadata.modelProject).toBe(
      '@proj/test-api-model',
    );

    // Create snapshots of generated files
    expect(
      tree.read('test-api/backend/src/handler.ts', 'utf-8'),
    ).toMatchSnapshot('handler.ts');
    expect(
      tree.read('test-api/backend/src/local-server.ts', 'utf-8'),
    ).toMatchSnapshot('local-server.ts');
    expect(
      tree.read('test-api/backend/src/service.ts', 'utf-8'),
    ).toMatchSnapshot('service.ts');
    expect(
      tree.read('test-api/backend/src/context.ts', 'utf-8'),
    ).toMatchSnapshot('context.ts');
    expect(
      tree.read('test-api/backend/src/operations/echo.ts', 'utf-8'),
    ).toMatchSnapshot('echo.ts');
    expect(tree.read('test-api/backend/project.json', 'utf-8')).toMatchSnapshot(
      'backend-project.json',
    );
    expect(tree.read('test-api/model/project.json', 'utf-8')).toMatchSnapshot(
      'model-project.json',
    );
  });

  it('should generate smithy ts api with custom directory', async () => {
    await tsSmithyApiGenerator(tree, {
      name: 'test-api',
      directory: 'apis',
      computeType: 'ServerlessApiGatewayRestApi',
      auth: 'None',
      iacProvider: 'CDK',
    });

    // Verify directory structure
    expect(tree.exists('apis/test-api/model')).toBeTruthy();
    expect(tree.exists('apis/test-api/backend')).toBeTruthy();
  });

  it('should generate smithy ts api with IAM auth', async () => {
    await tsSmithyApiGenerator(tree, {
      name: 'test-api',
      computeType: 'ServerlessApiGatewayRestApi',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    // Verify infrastructure files for IAM auth
    expect(
      tree.exists('packages/common/constructs/src/app/apis/test-api.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('packages/common/constructs/src/core/api/rest-api.ts'),
    ).toBeTruthy();

    const infraFile = tree.read(
      'packages/common/constructs/src/app/apis/test-api.ts',
      'utf-8',
    );
    expect(infraFile).toContain('IAM');

    // Verify backend project metadata
    const backendProjectConfig = readJson(
      tree,
      'test-api/backend/project.json',
    );
    expect(backendProjectConfig.metadata.auth).toBe('IAM');

    expect(
      tree.read('packages/common/constructs/src/app/apis/test-api.ts', 'utf-8'),
    ).toMatchSnapshot('iam-auth-infra.ts');
  });

  it('should generate smithy ts api with Cognito auth', async () => {
    await tsSmithyApiGenerator(tree, {
      name: 'test-api',
      computeType: 'ServerlessApiGatewayRestApi',
      auth: 'Cognito',
      iacProvider: 'CDK',
    });

    // Verify infrastructure files for Cognito auth
    expect(
      tree.exists('packages/common/constructs/src/app/apis/test-api.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('packages/common/constructs/src/core/api/rest-api.ts'),
    ).toBeTruthy();

    const infraFile = tree.read(
      'packages/common/constructs/src/app/apis/test-api.ts',
      'utf-8',
    );
    expect(infraFile).toContain('Cognito');

    // Verify backend project metadata
    const backendProjectConfig = readJson(
      tree,
      'test-api/backend/project.json',
    );
    expect(backendProjectConfig.metadata.auth).toBe('Cognito');

    expect(
      tree.read('packages/common/constructs/src/app/apis/test-api.ts', 'utf-8'),
    ).toMatchSnapshot('cognito-auth-infra.ts');
  });

  it('should generate smithy ts api with Terraform provider', async () => {
    await tsSmithyApiGenerator(tree, {
      name: 'test-api',
      computeType: 'ServerlessApiGatewayRestApi',
      auth: 'None',
      iacProvider: 'Terraform',
    });

    // Verify Terraform infrastructure files
    expect(tree.exists('packages/common/terraform')).toBeTruthy();
    expect(
      tree.exists(
        'packages/common/terraform/src/core/api/rest-api/rest-api.tf',
      ),
    ).toBeTruthy();
    expect(
      tree.exists(
        'packages/common/terraform/src/app/apis/test-api/test-api.tf',
      ),
    ).toBeTruthy();

    expect(
      tree.read(
        'packages/common/terraform/src/core/api/rest-api/rest-api.tf',
        'utf-8',
      ),
    ).toMatchSnapshot('terraform-infra.tf');
  });

  it('should generate smithy ts api with Terraform provider and None auth', async () => {
    await tsSmithyApiGenerator(tree, {
      name: 'test-api',
      computeType: 'ServerlessApiGatewayRestApi',
      auth: 'None',
      iacProvider: 'Terraform',
    });

    // Verify Terraform infrastructure files
    expect(tree.exists('packages/common/terraform')).toBeTruthy();
    expect(
      tree.exists(
        'packages/common/terraform/src/core/api/rest-api/rest-api.tf',
      ),
    ).toBeTruthy();
    expect(
      tree.exists(
        'packages/common/terraform/src/app/apis/test-api/test-api.tf',
      ),
    ).toBeTruthy();

    // Verify backend project metadata
    const backendProjectConfig = readJson(
      tree,
      'test-api/backend/project.json',
    );
    expect(backendProjectConfig.metadata.auth).toBe('None');

    expect(
      tree.read(
        'packages/common/terraform/src/app/apis/test-api/test-api.tf',
        'utf-8',
      ),
    ).toMatchSnapshot('none-auth-terraform.tf');
  });

  it('should generate smithy ts api with custom namespace', async () => {
    await tsSmithyApiGenerator(tree, {
      name: 'test-api',
      namespace: 'com.example.custom',
      computeType: 'ServerlessApiGatewayRestApi',
      auth: 'None',
      iacProvider: 'CDK',
    });

    const mainSmithy = tree.read('test-api/model/src/main.smithy', 'utf-8');
    expect(mainSmithy).toContain('namespace com.example.custom');
    expect(mainSmithy).toMatchSnapshot('custom-namespace-main.smithy');
  });

  it('should configure proper build dependencies between model and backend', async () => {
    await tsSmithyApiGenerator(tree, {
      name: 'test-api',
      computeType: 'ServerlessApiGatewayRestApi',
      auth: 'None',
      iacProvider: 'CDK',
    });

    const backendProjectConfig = readJson(
      tree,
      'test-api/backend/project.json',
    );

    // Verify copy-ssdk target depends on model build
    expect(backendProjectConfig.targets['copy-ssdk'].dependsOn).toContain(
      '@proj/test-api-model:build',
    );

    // Verify compile target depends on copy-ssdk
    expect(backendProjectConfig.targets.compile.dependsOn).toContain(
      'copy-ssdk',
    );

    // Verify serve target depends on copy-ssdk and watch-copy-ssdk
    expect(backendProjectConfig.targets.serve.dependsOn).toContain('copy-ssdk');
    expect(backendProjectConfig.targets.serve.dependsOn).toContain(
      'watch-copy-ssdk',
    );

    // Verify copy-ssdk configuration
    const copySsdkTarget = backendProjectConfig.targets['copy-ssdk'];
    expect(copySsdkTarget.executor).toBe('nx:run-commands');
    expect(copySsdkTarget.cache).toBe(true);
    expect(copySsdkTarget.outputs).toContain('{projectRoot}/src/generated');

    // Verify watch-copy-ssdk configuration
    const watchCopySsdkTarget = backendProjectConfig.targets['watch-copy-ssdk'];
    expect(watchCopySsdkTarget.executor).toBe('nx:run-commands');
    expect(watchCopySsdkTarget.continuous).toBe(true);
    expect(watchCopySsdkTarget.options.command).toContain('nx watch');
    expect(watchCopySsdkTarget.options.command).toContain(
      '@proj/test-api-model',
    );
  });

  it('should configure serve target for local development', async () => {
    await tsSmithyApiGenerator(tree, {
      name: 'test-api',
      computeType: 'ServerlessApiGatewayRestApi',
      auth: 'None',
      iacProvider: 'CDK',
    });

    const backendProjectConfig = readJson(
      tree,
      'test-api/backend/project.json',
    );
    const serveTarget = backendProjectConfig.targets.serve;

    expect(serveTarget.executor).toBe('nx:run-commands');
    expect(serveTarget.continuous).toBe(true);
    expect(serveTarget.options.command).toContain(
      'tsx --watch src/local-server.ts',
    );
    expect(serveTarget.options.cwd).toBe('{projectRoot}');
  });

  it('should add dependencies to package.json', async () => {
    await tsSmithyApiGenerator(tree, {
      name: 'test-api',
      computeType: 'ServerlessApiGatewayRestApi',
      auth: 'None',
      iacProvider: 'CDK',
    });

    const packageJson = readJson(tree, 'package.json');

    // Verify runtime dependencies
    expect(packageJson.dependencies).toHaveProperty(
      '@aws-smithy/server-apigateway',
    );
    expect(packageJson.dependencies).toHaveProperty('@aws-smithy/server-node');
    expect(packageJson.dependencies).toHaveProperty('@middy/core');

    // Powertools
    expect(packageJson.dependencies).toHaveProperty(
      '@aws-lambda-powertools/metrics',
    );
    expect(packageJson.dependencies).toHaveProperty(
      '@aws-lambda-powertools/tracer',
    );
    expect(packageJson.dependencies).toHaveProperty(
      '@aws-lambda-powertools/logger',
    );

    // Verify dev dependencies
    expect(packageJson.devDependencies).toHaveProperty('@types/aws-lambda');
  });

  it('should configure git and eslint ignores for generated code', async () => {
    await tsSmithyApiGenerator(tree, {
      name: 'test-api',
      computeType: 'ServerlessApiGatewayRestApi',
      auth: 'None',
      iacProvider: 'CDK',
    });

    // Verify .gitignore
    const gitignore = tree.read('test-api/backend/.gitignore', 'utf-8');
    expect(gitignore).toContain('src/generated');

    // Verify eslint config
    const eslintConfig = tree.read(
      'test-api/backend/eslint.config.mjs',
      'utf-8',
    );
    expect(eslintConfig).toContain('**/generated');

    expect(gitignore).toMatchSnapshot('gitignore');
    expect(eslintConfig).toMatchSnapshot('eslint.config.mjs');
  });

  it('should configure bundle target', async () => {
    await tsSmithyApiGenerator(tree, {
      name: 'test-api',
      computeType: 'ServerlessApiGatewayRestApi',
      auth: 'None',
      iacProvider: 'CDK',
    });

    const backendProjectConfig = readJson(
      tree,
      'test-api/backend/project.json',
    );
    expect(backendProjectConfig.targets.bundle).toBeDefined();

    const bundleTarget = backendProjectConfig.targets.bundle;
    expect(bundleTarget.executor).toBe('nx:run-commands');
    expect(bundleTarget.options.command).toEqual(
      'rolldown -c rolldown.config.ts',
    );
  });

  it('should add generator metadata to backend project configuration', async () => {
    await tsSmithyApiGenerator(tree, {
      name: 'test-api',
      computeType: 'ServerlessApiGatewayRestApi',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    const backendProjectConfig = readJson(
      tree,
      'test-api/backend/project.json',
    );
    expect(backendProjectConfig.metadata).toHaveProperty(
      'generator',
      TS_SMITHY_API_GENERATOR_INFO.id,
    );
    expect(backendProjectConfig.metadata).toHaveProperty('apiName', 'test-api');
    expect(backendProjectConfig.metadata).toHaveProperty('auth', 'IAM');
    expect(backendProjectConfig.metadata).toHaveProperty(
      'modelProject',
      '@proj/test-api-model',
    );
  });

  it('should add generator metric to app.ts when shared constructs exist', async () => {
    // Set up test tree with shared constructs
    await sharedConstructsGenerator(tree, { iacProvider: 'CDK' });

    // Call the generator function
    await tsSmithyApiGenerator(tree, {
      name: 'test-api',
      computeType: 'ServerlessApiGatewayRestApi',
      auth: 'None',
      iacProvider: 'CDK',
    });

    // Verify the metric was added to app.ts
    expectHasMetricTags(tree, TS_SMITHY_API_GENERATOR_INFO.metric);
  });

  it('should assign unique port for local server', async () => {
    // Generate first API
    await tsSmithyApiGenerator(tree, {
      name: 'api-one',
      computeType: 'ServerlessApiGatewayRestApi',
      auth: 'None',
      iacProvider: 'CDK',
    });

    // Generate second API
    await tsSmithyApiGenerator(tree, {
      name: 'api-two',
      computeType: 'ServerlessApiGatewayRestApi',
      auth: 'None',
      iacProvider: 'CDK',
    });

    // Check metadata ports instead of parsing files
    const apiOneConfig = readJson(tree, 'api-one/backend/project.json');
    const apiTwoConfig = readJson(tree, 'api-two/backend/project.json');

    expect(apiOneConfig.metadata.ports).toBeDefined();
    expect(apiTwoConfig.metadata.ports).toBeDefined();
    expect(apiOneConfig.metadata.ports[0]).not.toBe(
      apiTwoConfig.metadata.ports[0],
    );
  });

  it('should configure OpenAPI metadata generation target', async () => {
    await tsSmithyApiGenerator(tree, {
      name: 'test-api',
      computeType: 'ServerlessApiGatewayRestApi',
      auth: 'None',
      iacProvider: 'CDK',
    });

    // Verify shared constructs has OpenAPI metadata target
    const sharedConstructsConfig = readJson(
      tree,
      'packages/common/constructs/project.json',
    );
    expect(
      sharedConstructsConfig.targets['generate:test-api-metadata'],
    ).toBeDefined();

    const openApiTarget =
      sharedConstructsConfig.targets['generate:test-api-metadata'];
    expect(openApiTarget.dependsOn).toContain('@proj/test-api-model:build');
    expect(openApiTarget.options.commands).toContain(
      'nx g @aws/nx-plugin:open-api#ts-metadata --openApiSpecPath="dist/test-api/model/build/openapi/openapi.json" --outputPath="packages/common/constructs/src/generated/test-api" --no-interactive',
    );
  });

  it('should handle kebab-case API names correctly', async () => {
    await tsSmithyApiGenerator(tree, {
      name: 'my-test-api',
      computeType: 'ServerlessApiGatewayRestApi',
      auth: 'None',
      iacProvider: 'CDK',
    });

    // Verify model project name
    expect(tree.exists('my-test-api/model')).toBeTruthy();

    // Verify backend project name
    expect(tree.exists('my-test-api/backend')).toBeTruthy();

    // Verify service name in Smithy model
    const mainSmithy = tree.read('my-test-api/model/src/main.smithy', 'utf-8');
    expect(mainSmithy).toContain('service MyTestApi');
    expect(mainSmithy).toContain('@title("MyTestApi")');

    // Verify handler uses correct class name
    const handler = tree.read('my-test-api/backend/src/handler.ts', 'utf-8');
    expect(handler).toContain('MyTestApi');

    expect(mainSmithy).toMatchSnapshot('kebab-case-main.smithy');
    expect(handler).toMatchSnapshot('kebab-case-handler.ts');
  });

  describe('terraform iacProvider', () => {
    it('should generate terraform files for REST API with IAM auth and snapshot them', async () => {
      await tsSmithyApiGenerator(tree, {
        name: 'test-api',
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

      // Verify Smithy-specific handler configuration
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
      await tsSmithyApiGenerator(tree, {
        name: 'test-api',
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

      // Verify Smithy-specific handler configuration
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

    it('should configure project targets and dependencies correctly for terraform', async () => {
      await tsSmithyApiGenerator(tree, {
        name: 'test-api',
        computeType: 'ServerlessApiGatewayRestApi',
        auth: 'IAM',
        iacProvider: 'Terraform',
      });

      // Check that shared terraform project has build dependency on the API project
      const sharedTerraformConfig = readJson(
        tree,
        'packages/common/terraform/project.json',
      );

      expect(sharedTerraformConfig.targets.build.dependsOn).toContain(
        '@proj/test-api:build',
      );

      // Verify that CDK-specific metadata generation targets are NOT added for terraform
      expect(
        sharedTerraformConfig.targets['generate:test-api-metadata'],
      ).not.toBeDefined();

      const projectConfig = readJson(tree, 'test-api/backend/project.json');

      // Should still have basic Smithy targets
      expect(projectConfig.targets.bundle).toBeDefined();
      expect(projectConfig.targets.serve).toBeDefined();
      expect(projectConfig.targets['copy-ssdk']).toBeDefined();
      expect(projectConfig.targets.build.dependsOn).toContain('bundle');
    });

    it('should not create CDK constructs when using terraform', async () => {
      await tsSmithyApiGenerator(tree, {
        name: 'test-api',
        computeType: 'ServerlessApiGatewayRestApi',
        auth: 'IAM',
        iacProvider: 'Terraform',
      });

      // Verify CDK files are NOT created
      expect(
        tree.exists('packages/common/constructs/src/app/apis/test-api.ts'),
      ).toBeFalsy();
      expect(
        tree.exists('packages/common/constructs/src/core/api/rest-api.ts'),
      ).toBeFalsy();
    });

    it('should throw error for invalid iacProvider', async () => {
      await expect(
        tsSmithyApiGenerator(tree, {
          name: 'test-api',
          computeType: 'ServerlessApiGatewayRestApi',
          auth: 'IAM',
          iacProvider: 'InvalidProvider' as any,
        }),
      ).rejects.toThrow('Unsupported iacProvider InvalidProvider');
    });

    it('should inherit iacProvider from config when set to Inherit', async () => {
      // Set up config with CDK provider using utility methods
      await ensureAwsNxPluginConfig(tree);
      await updateAwsNxPluginConfig(tree, {
        iac: {
          provider: 'CDK',
        },
      });

      await tsSmithyApiGenerator(tree, {
        name: 'test-api',
        computeType: 'ServerlessApiGatewayRestApi',
        auth: 'IAM',
        iacProvider: 'Inherit',
      });

      // Verify CDK constructs are created (not terraform)
      expect(tree.exists('packages/common/constructs')).toBeTruthy();
      expect(tree.exists('packages/common/terraform')).toBeFalsy();
      expect(
        tree.exists('packages/common/constructs/src/app/apis/test-api.ts'),
      ).toBeTruthy();
    });

    it('should handle terraform with different directory structures', async () => {
      await tsSmithyApiGenerator(tree, {
        name: 'nested-api',
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
        'dist/apps/nested/path/nested-api/backend/bundle',
      );
      expect(terraformContent).toContain(
        'authorization = "COGNITO_USER_POOLS"',
      );
    });

    it('should generate terraform with custom namespace', async () => {
      await tsSmithyApiGenerator(tree, {
        name: 'custom-api',
        namespace: 'com.example.custom',
        computeType: 'ServerlessApiGatewayRestApi',
        auth: 'None',
        iacProvider: 'Terraform',
      });

      // Verify terraform files are created
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );

      expect(terraformFiles.length).toBeGreaterThan(0);

      // Verify the Smithy model has the custom namespace
      const mainSmithy = tree.read('custom-api/model/src/main.smithy', 'utf-8');
      expect(mainSmithy).toContain('namespace com.example.custom');

      // Snapshot the terraform file for custom namespace
      const appApiFile = terraformFiles.find((f) => f.includes('custom-api'));
      expect(appApiFile).toBeDefined();

      const terraformContent = tree.read(appApiFile!, 'utf-8');
      expect(terraformContent).toMatchSnapshot('terraform-custom-namespace.tf');
    });
  });
});
