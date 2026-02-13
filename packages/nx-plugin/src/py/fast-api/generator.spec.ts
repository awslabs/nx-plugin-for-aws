/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import {
  FAST_API_GENERATOR_INFO,
  pyFastApiProjectGenerator,
} from './generator';
import { parse } from '@iarna/toml';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../utils/shared-constructs-constants';
import { joinPathFragments } from '@nx/devkit';
import type { UVPyprojectToml } from '../../utils/nxlv-python';
import { sortObjectKeys } from '../../utils/object';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../../utils/config/utils';

describe('fastapi project generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should generate a FastAPI project with correct structure', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    // Verify project structure
    expect(tree.exists('apps/test_api')).toBeTruthy();
    expect(tree.exists('apps/test_api/proj_test_api')).toBeTruthy();
    expect(tree.exists('apps/test_api/proj_test_api/main.py')).toBeTruthy();
    expect(tree.exists('apps/test_api/tests/test_main.py')).toBeTruthy();

    // Verify default files are removed
    expect(tree.exists('apps/test_api/proj_test_api/hello.py')).toBeFalsy();
    expect(tree.exists('apps/test_api/tests/test_hello.py')).toBeFalsy();
  });

  it('should generate a FastAPI project with custom module name', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
      moduleName: 'my_module',
      iacProvider: 'CDK',
    });

    // Verify project structure
    expect(tree.exists('apps/test_api')).toBeTruthy();
    expect(tree.exists('apps/test_api/my_module')).toBeTruthy();
    expect(tree.exists('apps/test_api/my_module/main.py')).toBeTruthy();
  });

  it('should set up project configuration with FastAPI targets', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test_api/project.json', 'utf-8'),
    );

    // Verify FastAPI-specific targets
    expect(projectConfig.targets['bundle-x86']).toBeDefined();
    expect(projectConfig.targets['bundle-x86'].outputs).toEqual([
      '{workspaceRoot}/dist/apps/test_api/bundle-x86',
    ]);
    expect(projectConfig.targets['bundle-x86'].options.commands).toContain(
      'uv export --frozen --no-dev --no-editable --project apps/test_api --package proj.test_api -o dist/apps/test_api/bundle-x86/requirements.txt',
    );

    // Verify openapi spec is generated
    expect(projectConfig.targets.openapi).toBeDefined();
    expect(projectConfig.targets.openapi.options.commands).toContain(
      'uv run python apps/test_api/scripts/generate_open_api.py "dist/apps/test_api/openapi/openapi.json"',
    );

    // Verify start target for development
    expect(projectConfig.targets.serve).toBeDefined();
    expect(projectConfig.targets.serve.executor).toBe(
      '@nxlv/python:run-commands',
    );
    expect(projectConfig.targets.serve.options.command).toBe(
      'uv run fastapi dev proj_test_api/main.py --port 8000',
    );

    // Verify build dependencies
    expect(projectConfig.targets.build.dependsOn).toContain('bundle');
    expect(projectConfig.targets.build.dependsOn).toContain('openapi');
  });

  it('should configure FastAPI dependencies', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    const pyprojectToml = parse(
      tree.read('apps/test_api/pyproject.toml', 'utf-8'),
    ) as UVPyprojectToml;

    // Verify FastAPI dependencies
    expect(
      pyprojectToml.project.dependencies.some((dep) =>
        dep.startsWith('fastapi=='),
      ),
    ).toBe(true);
    expect(
      pyprojectToml.project.dependencies.some((dep) =>
        dep.startsWith('mangum=='),
      ),
    ).toBe(true);
    expect(
      pyprojectToml['dependency-groups'].dev.some((dep) =>
        dep.startsWith('fastapi[standard]=='),
      ),
    ).toBe(true);
  });

  it('should set up shared constructs for http', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps/nested/path',
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
      tree.exists('packages/common/constructs/src/core/api/trpc-utils.ts'),
    ).toBeFalsy();

    expect(
      tree.exists('packages/common/constructs/src/core/api/rest-api.ts'),
    ).toBeFalsy();

    // Check scope is included in function handler
    expect(
      tree.read('packages/common/constructs/src/app/apis/test-api.ts', 'utf-8'),
    ).toContain("handler: 'proj_test_api.main.handler'");
  });

  it('should set up shared constructs for rest', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps/nested/path',
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
      tree.exists('packages/common/constructs/src/core/api/trpc-utils.ts'),
    ).toBeFalsy();

    expect(
      tree.exists('packages/common/constructs/src/core/api/http-api.ts'),
    ).toBeFalsy();

    // Check scope is included in function handler
    expect(
      tree.read('packages/common/constructs/src/app/apis/test-api.ts', 'utf-8'),
    ).toContain("handler: 'proj_test_api.main.handler'");
  });

  it('should update shared constructs build dependencies', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    const sharedConstructsConfig = JSON.parse(
      tree.read(
        joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'project.json'),
        'utf-8',
      ),
    );

    expect(sharedConstructsConfig.targets.build.dependsOn).toContain(
      'proj.test_api:build',
    );
    expect(sharedConstructsConfig.targets.compile.dependsOn).toContain(
      'generate:test-api-metadata',
    );
  });

  it('should handle custom directory path', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps/nested/path',
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    expect(tree.exists('apps/nested/path/test_api')).toBeTruthy();
    expect(
      tree.exists('apps/nested/path/test_api/proj_test_api/main.py'),
    ).toBeTruthy();
  });

  it('should set project metadata', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    const config = JSON.parse(tree.read('apps/test_api/project.json', 'utf-8'));
    // Verify project metadata
    expect(config.metadata).toEqual({
      apiName: 'test-api',
      apiType: 'fast-api',
      auth: 'IAM',
      generator: FAST_API_GENERATOR_INFO.id,
      ports: [8000],
    });
  });

  it('should match snapshot', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    const appChanges = sortObjectKeys(
      tree
        .listChanges()
        .filter((f) => f.path.endsWith('.py'))
        .reduce((acc, curr) => {
          acc[curr.path] = tree.read(curr.path, 'utf-8');
          return acc;
        }, {}),
    );
    // Verify project metadata
    expect(appChanges).toMatchSnapshot('main-snapshot');
  });

  it('should add generator metric to app.ts', async () => {
    // Call the generator function
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    // Verify the metric was added to app.ts
    expectHasMetricTags(tree, FAST_API_GENERATOR_INFO.metric);
  });

  it.each(['Rest', 'Http'])(
    'should include CORS middleware in init.py when using %s API',
    async (api: 'Rest' | 'Http') => {
      await pyFastApiProjectGenerator(tree, {
        name: 'test-api',
        directory: 'apps',
        computeType: `ServerlessApiGateway${api}Api`,
        auth: 'IAM',
        iacProvider: 'CDK',
      });

      // Read the generated init.py file
      const initPyContent = tree.read(
        'apps/test_api/proj_test_api/init.py',
        'utf-8',
      );

      // Verify CORS origin is configured
      expect(initPyContent).toContain(
        'response.headers["Access-Control-Allow-Origin"] = cors_origin',
      );
    },
  );

  it('should increment ports when running generator multiple times', async () => {
    // Generate first API
    await pyFastApiProjectGenerator(tree, {
      name: 'first-api',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    // Generate second API
    await pyFastApiProjectGenerator(tree, {
      name: 'second-api',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    // Generate third API
    await pyFastApiProjectGenerator(tree, {
      name: 'third-api',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    // Check metadata ports
    const firstApiConfig = JSON.parse(
      tree.read('apps/first_api/project.json', 'utf-8'),
    );
    const secondApiConfig = JSON.parse(
      tree.read('apps/second_api/project.json', 'utf-8'),
    );
    const thirdApiConfig = JSON.parse(
      tree.read('apps/third_api/project.json', 'utf-8'),
    );

    expect(firstApiConfig.metadata.ports).toEqual([8000]);
    expect(secondApiConfig.metadata.ports).toEqual([8001]);
    expect(thirdApiConfig.metadata.ports).toEqual([8002]);

    // Check serve target --port arguments
    expect(firstApiConfig.targets.serve.options.command).toContain(
      '--port 8000',
    );
    expect(secondApiConfig.targets.serve.options.command).toContain(
      '--port 8001',
    );
    expect(thirdApiConfig.targets.serve.options.command).toContain(
      '--port 8002',
    );
  });

  describe('terraform iacProvider', () => {
    it('should generate terraform files for HTTP API with IAM auth and snapshot them', async () => {
      await pyFastApiProjectGenerator(tree, {
        name: 'test-api',
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

      // Verify FastAPI-specific handler configuration
      expect(appApiContent).toMatch(
        /handler\s+=\s+"proj_test_api\.main\.handler"/,
      );
      expect(appApiContent).toMatch(/runtime\s+=\s+"python3\.12"/);

      // Snapshot terraform files
      const terraformFileContents = {
        'http-api.tf': coreApiContent,
        'test-api.tf': appApiContent,
      };

      expect(terraformFileContents).toMatchSnapshot('terraform-http-iam-files');
    });

    it('should generate terraform files for HTTP API with Cognito auth and snapshot them', async () => {
      await pyFastApiProjectGenerator(tree, {
        name: 'test-api',
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

      // Verify FastAPI-specific handler configuration
      expect(appApiContent).toMatch(
        /handler\s+=\s+"proj_test_api\.main\.handler"/,
      );
      expect(appApiContent).toMatch(/runtime\s+=\s+"python3\.12"/);

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
      await pyFastApiProjectGenerator(tree, {
        name: 'test-api',
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

      // Verify FastAPI-specific handler configuration
      expect(appApiContent).toMatch(
        /handler\s+=\s+"proj_test_api\.main\.handler"/,
      );
      expect(appApiContent).toMatch(/runtime\s+=\s+"python3\.12"/);

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
      await pyFastApiProjectGenerator(tree, {
        name: 'test-api',
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

      // Verify FastAPI-specific handler configuration
      expect(appApiContent).toMatch(
        /handler\s+=\s+"proj_test_api\.main\.handler"/,
      );
      expect(appApiContent).toMatch(/runtime\s+=\s+"python3\.12"/);

      // Snapshot terraform files
      const terraformFileContents = {
        'rest-api.tf': coreApiContent,
        'test-api.tf': appApiContent,
      };

      expect(terraformFileContents).toMatchSnapshot('terraform-rest-iam-files');
    });

    it('should generate terraform files for REST API with Cognito auth and snapshot them', async () => {
      await pyFastApiProjectGenerator(tree, {
        name: 'test-api',
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

      // Verify FastAPI-specific handler configuration
      expect(appApiContent).toMatch(
        /handler\s+=\s+"proj_test_api\.main\.handler"/,
      );
      expect(appApiContent).toMatch(/runtime\s+=\s+"python3\.12"/);

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
      await pyFastApiProjectGenerator(tree, {
        name: 'test-api',
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

      // Verify FastAPI-specific handler configuration
      expect(appApiContent).toMatch(
        /handler\s+=\s+"proj_test_api\.main\.handler"/,
      );
      expect(appApiContent).toMatch(/runtime\s+=\s+"python3\.12"/);

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
      await pyFastApiProjectGenerator(tree, {
        name: 'test-api',
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
        'proj.test_api:build',
      );

      // Verify that CDK-specific metadata generation targets are NOT added for terraform
      expect(
        sharedTerraformConfig.targets['generate:test-api-metadata'],
      ).not.toBeDefined();

      const projectConfig = JSON.parse(
        tree.read('apps/test_api/project.json', 'utf-8'),
      );

      // Should still have basic FastAPI targets
      expect(projectConfig.targets['bundle-x86']).toBeDefined();
      expect(projectConfig.targets.openapi).toBeDefined();
      expect(projectConfig.targets.serve).toBeDefined();
      expect(projectConfig.targets.build.dependsOn).toContain('bundle');
      expect(projectConfig.targets.build.dependsOn).toContain('openapi');
    });

    it('should not create CDK constructs when using terraform', async () => {
      await pyFastApiProjectGenerator(tree, {
        name: 'test-api',
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
        pyFastApiProjectGenerator(tree, {
          name: 'test-api',
          directory: 'apps',
          computeType: 'ServerlessApiGatewayHttpApi',
          auth: 'IAM',
          iacProvider: 'InvalidProvider' as any,
        }),
      ).rejects.toThrow('Unsupported iacProvider InvalidProvider');
    });

    it('should generate correct FastAPI handler configuration with custom module name', async () => {
      await pyFastApiProjectGenerator(tree, {
        name: 'test-api',
        directory: 'apps',
        computeType: 'ServerlessApiGatewayHttpApi',
        auth: 'IAM',
        iacProvider: 'Terraform',
        moduleName: 'custom_module',
      });

      // Find the actual terraform app file
      const allFiles = tree.listChanges().map((f) => f.path);
      const appApiFile = allFiles.find(
        (f) =>
          f.includes('terraform') &&
          f.includes('test-api') &&
          f.endsWith('.tf'),
      );

      expect(appApiFile).toBeDefined();

      const terraformFile = tree.read(appApiFile!, 'utf-8');

      // Verify FastAPI-specific handler configuration with custom module
      expect(terraformFile).toMatch(
        /handler\s+=\s+"custom_module\.main\.handler"/,
      );
      expect(terraformFile).toMatch(/runtime\s+=\s+"python3\.12"/);
    });

    it('should handle terraform with different directory structures', async () => {
      await pyFastApiProjectGenerator(tree, {
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
        'dist/apps/nested/path/nested_api/bundle',
      );
      expect(terraformContent).toContain(
        'authorization = "COGNITO_USER_POOLS"',
      );
    });
  });

  it('should inherit iacProvider from config when set to Inherit', async () => {
    // Set up config with CDK provider using utility methods
    await ensureAwsNxPluginConfig(tree);
    await updateAwsNxPluginConfig(tree, {
      iac: {
        provider: 'CDK',
      },
    });

    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
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
});
