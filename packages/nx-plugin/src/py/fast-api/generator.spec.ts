/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { parse } from '@iarna/toml';
import { joinPathFragments, type Tree } from '@nx/devkit';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../../utils/config/utils';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import type { UVPyprojectToml } from '../../utils/nxlv-python';
import { sortObjectKeys } from '../../utils/object';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../utils/shared-constructs-constants';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import {
  FAST_API_GENERATOR_INFO,
  pyFastApiProjectGenerator,
} from './generator';

describe('fastapi project generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should generate a FastAPI project with correct structure', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
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
      infra: 'http-lambda',
      auth: 'iam',
      moduleName: 'my_module',
      iac: 'cdk',
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
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test_api/project.json', 'utf-8'),
    );

    // Verify FastAPI-specific targets
    expect(projectConfig.targets['bundle-x86']).toBeDefined();
    expect(projectConfig.targets['bundle-x86'].outputs).toEqual([
      '{workspaceRoot}/dist/{projectRoot}/bundle-x86',
    ]);
    expect(projectConfig.targets['bundle-x86'].options.commands).toContain(
      'uv export --frozen --no-dev --no-editable --project {projectRoot} --package proj.test_api -o dist/{projectRoot}/bundle-x86/requirements.txt',
    );

    // Verify openapi spec is generated
    expect(projectConfig.targets.openapi).toBeDefined();
    expect(projectConfig.targets.openapi.options.commands).toContain(
      'uv run python {projectRoot}/scripts/generate_open_api.py "dist/{projectRoot}/openapi/openapi.json"',
    );

    // Verify start target for development
    expect(projectConfig.targets.serve).toBeDefined();
    expect(projectConfig.targets.serve.executor).toBe(
      '@nxlv/python:run-commands',
    );
    expect(projectConfig.targets.serve.options.command).toBe(
      'uv run fastapi dev proj_test_api/main.py --port 8000',
    );
    expect(projectConfig.targets['serve-local']).toBeDefined();
    expect(projectConfig.targets['serve-local'].executor).toBe(
      '@nxlv/python:run-commands',
    );
    expect(projectConfig.targets['serve-local'].options.command).toBe(
      'uv run fastapi dev proj_test_api/main.py --port 8000',
    );
    expect(projectConfig.targets['serve-local'].options.env).toEqual({
      SERVE_LOCAL: 'true',
    });

    // Verify build dependencies
    expect(projectConfig.targets.build.dependsOn).toContain('bundle');
    expect(projectConfig.targets.build.dependsOn).toContain('openapi');
  });

  it('should configure FastAPI dependencies', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
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
        dep.startsWith('uvicorn=='),
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
      infra: 'http-lambda',
      auth: 'iam',
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
      tree.exists('packages/common/constructs/src/core/api/trpc-utils.ts'),
    ).toBeFalsy();

    expect(
      tree.exists('packages/common/constructs/src/core/api/rest-api.ts'),
    ).toBeFalsy();

    // Check handler is set to run.sh for Lambda Web Adapter
    expect(
      tree.read('packages/common/constructs/src/app/apis/test-api.ts', 'utf-8'),
    ).toContain("handler: 'run.sh'");
  });

  it('should generate a shared router lambda for REST APIs when using the shared integration pattern', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      infra: 'rest-lambda',
      integrationPattern: 'shared',
      auth: 'iam',
      iac: 'cdk',
    });

    const appApiContent = tree.read(
      'packages/common/constructs/src/app/apis/test-api.ts',
      'utf-8',
    );

    expect(appApiContent).toContain("pattern: 'shared'");
    expect(appApiContent).toContain('scopePermissionToMethod: false');
    expect(appApiContent).toContain(
      'responseTransferMode: ResponseTransferMode.STREAM',
    );
    expect(appApiContent).toContain("handler: 'run.sh'");
  });

  it('should generate a shared router lambda for HTTP APIs when using the shared integration pattern', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      infra: 'http-lambda',
      integrationPattern: 'shared',
      auth: 'iam',
      iac: 'cdk',
    });

    const appApiContent = tree.read(
      'packages/common/constructs/src/app/apis/test-api.ts',
      'utf-8',
    );

    expect(appApiContent).toContain("pattern: 'shared'");
    expect(appApiContent).toContain('scopePermissionToRoute: false');
    expect(appApiContent).toContain('`TestApiRouter${op}Integration`');
    expect(appApiContent).toContain("handler: 'run.sh'");
  });

  it('should set up shared constructs for rest', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps/nested/path',
      infra: 'rest-lambda',
      auth: 'iam',
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
      tree.exists('packages/common/constructs/src/core/api/trpc-utils.ts'),
    ).toBeFalsy();

    expect(
      tree.exists('packages/common/constructs/src/core/api/http-api.ts'),
    ).toBeFalsy();

    // Check handler is set to run.sh for Lambda Web Adapter
    expect(
      tree.read('packages/common/constructs/src/app/apis/test-api.ts', 'utf-8'),
    ).toContain("handler: 'run.sh'");
  });

  it('should update shared constructs build dependencies', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
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
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
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
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
    });

    const config = JSON.parse(tree.read('apps/test_api/project.json', 'utf-8'));
    // Verify project metadata
    expect(config.metadata).toEqual({
      apiName: 'test-api',
      apiType: 'fast-api',
      auth: 'iam',
      generator: FAST_API_GENERATOR_INFO.id,
      ports: [8000],
    });
  });

  it('should match snapshot', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
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
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
    });

    // Verify the metric was added to app.ts
    expectHasMetricTags(tree, FAST_API_GENERATOR_INFO.metric);
  });

  it.each([
    'rest-lambda',
    'http-lambda',
  ])('should include CORS middleware in init.py when using %s infra', async (infra:
    | 'rest-lambda'
    | 'http-lambda') => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      infra,
      auth: 'iam',
      iac: 'cdk',
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
  });

  it('should increment ports when running generator multiple times', async () => {
    // Generate first API
    await pyFastApiProjectGenerator(tree, {
      name: 'first-api',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
    });

    // Generate second API
    await pyFastApiProjectGenerator(tree, {
      name: 'second-api',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
    });

    // Generate third API
    await pyFastApiProjectGenerator(tree, {
      name: 'third-api',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
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

  it('should be idempotent when re-run with same options', async () => {
    const options = {
      name: 'test-api',
      directory: 'apps',
      infra: 'http-lambda' as const,
      auth: 'iam' as const,
      iac: 'cdk' as const,
    };
    await pyFastApiProjectGenerator(tree, options);
    const firstProjectJson = tree.read('apps/test_api/project.json', 'utf-8');
    const firstInitPy = tree.read('apps/test_api/proj_test_api/init.py', 'utf-8');
    const firstGenerateOpenApi = tree.read(
      'apps/test_api/scripts/generate_open_api.py',
      'utf-8',
    );

    await pyFastApiProjectGenerator(tree, options);
    const secondProjectJson = tree.read('apps/test_api/project.json', 'utf-8');

    const projectConfig = JSON.parse(secondProjectJson);

    // Port metadata should not grow on re-run
    expect(projectConfig.metadata.ports).toHaveLength(1);

    // The run.sh copy command should appear exactly once
    const bundleCommands = projectConfig.targets['bundle-x86'].options
      .commands as string[];
    expect(bundleCommands.filter((c) => c.includes('run.sh'))).toHaveLength(1);

    expect(secondProjectJson).toEqual(firstProjectJson);

    // User-owned and generated Python files must be byte-identical on re-run
    expect(tree.read('apps/test_api/proj_test_api/init.py', 'utf-8')).toEqual(
      firstInitPy,
    );
    expect(
      tree.read('apps/test_api/scripts/generate_open_api.py', 'utf-8'),
    ).toEqual(firstGenerateOpenApi);
  });

  describe('terraform iac', () => {
    it('should generate terraform files for HTTP API with IAM auth and snapshot them', async () => {
      await pyFastApiProjectGenerator(tree, {
        name: 'test-api',
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

      // Verify FastAPI-specific handler configuration (Lambda Web Adapter)
      expect(appApiContent).toMatch(/handler\s+=\s+"run\.sh"/);
      expect(appApiContent).toMatch(/runtime\s+=\s+"python3\.14"/);

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

      // Verify FastAPI-specific handler configuration
      expect(appApiContent).toMatch(/handler\s+=\s+"run\.sh"/);
      expect(appApiContent).toMatch(/runtime\s+=\s+"python3\.14"/);

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
      await pyFastApiProjectGenerator(tree, {
        name: 'test-api',
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

      // Verify FastAPI-specific handler configuration
      expect(appApiContent).toMatch(/handler\s+=\s+"run\.sh"/);
      expect(appApiContent).toMatch(/runtime\s+=\s+"python3\.14"/);

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
      await pyFastApiProjectGenerator(tree, {
        name: 'test-api',
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

      // Verify FastAPI-specific handler configuration
      expect(appApiContent).toMatch(/handler\s+=\s+"run\.sh"/);
      expect(appApiContent).toMatch(/runtime\s+=\s+"python3\.14"/);

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

      // Verify FastAPI-specific handler configuration
      expect(appApiContent).toMatch(/handler\s+=\s+"run\.sh"/);
      expect(appApiContent).toMatch(/runtime\s+=\s+"python3\.14"/);

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

      // Verify FastAPI-specific handler configuration
      expect(appApiContent).toMatch(/handler\s+=\s+"run\.sh"/);
      expect(appApiContent).toMatch(/runtime\s+=\s+"python3\.14"/);

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
        infra: 'http-lambda',
        auth: 'iam',
        iac: 'terraform',
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
        pyFastApiProjectGenerator(tree, {
          name: 'test-api',
          directory: 'apps',
          infra: 'http-lambda',
          auth: 'iam',
          iac: 'InvalidProvider' as any,
        }),
      ).rejects.toThrow('Unsupported iac InvalidProvider');
    });

    it('should generate correct FastAPI handler configuration with custom module name', async () => {
      await pyFastApiProjectGenerator(tree, {
        name: 'test-api',
        directory: 'apps',
        infra: 'http-lambda',
        auth: 'iam',
        iac: 'terraform',
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
      expect(terraformFile).toMatch(/handler\s+=\s+"run\.sh"/);
      expect(terraformFile).toMatch(/runtime\s+=\s+"python3\.14"/);
    });

    it('should handle terraform with different directory structures', async () => {
      await pyFastApiProjectGenerator(tree, {
        name: 'nested-api',
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
        'dist/apps/nested/path/nested_api/bundle',
      );
      expect(terraformContent).toContain(
        'authorization = "COGNITO_USER_POOLS"',
      );
    });
  });

  it('should inherit iac from config when set to Inherit', async () => {
    // Set up config with CDK provider using utility methods
    await ensureAwsNxPluginConfig(tree);
    await updateAwsNxPluginConfig(tree, {
      iac: {
        provider: 'cdk',
      },
    });

    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'inherit',
    });

    // Verify CDK constructs are created (not terraform)
    expect(tree.exists('packages/common/constructs')).toBeTruthy();
    expect(tree.exists('packages/common/terraform')).toBeFalsy();
    expect(
      tree.exists('packages/common/constructs/src/app/apis/test-api.ts'),
    ).toBeTruthy();
  });

  it('should place project in subDirectory when provided', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'packages',
      subDirectory: 'apis',
      infra: 'http-lambda',
      auth: 'iam',
      iac: 'cdk',
    });
    expect(tree.exists('packages/apis')).toBeTruthy();
    expect(tree.exists('packages/apis/pyproject.toml')).toBeTruthy();
  });

  it('should generate with infra=none then upgrade to infra=rest-lambda', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'upgrade-api',
      directory: 'apps',
      infra: 'none',
      auth: 'iam',
      iac: 'cdk',
    });

    expect(
      tree.exists('apps/upgrade_api/proj_upgrade_api/main.py'),
    ).toBeTruthy();
    expect(tree.exists('packages/common/constructs')).toBeFalsy();

    await pyFastApiProjectGenerator(tree, {
      name: 'upgrade-api',
      directory: 'apps',
      infra: 'rest-lambda',
      auth: 'iam',
      iac: 'cdk',
    });

    expect(tree.exists('packages/common/constructs')).toBeTruthy();
  });
});
