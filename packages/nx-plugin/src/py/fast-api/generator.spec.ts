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
import { UVPyprojectToml } from '@nxlv/python/src/provider/uv/types';
import { sortObjectKeys } from '../../utils/object';
import { expectHasMetricTags } from '../../utils/metrics.spec';

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
    });

    // Verify project structure
    expect(tree.exists('apps/test_api')).toBeTruthy();
    expect(tree.exists('apps/test_api/test_api')).toBeTruthy();
    expect(tree.exists('apps/test_api/test_api/main.py')).toBeTruthy();
    expect(tree.exists('apps/test_api/tests/test_main.py')).toBeTruthy();

    // Verify default files are removed
    expect(tree.exists('apps/test_api/test_api/hello.py')).toBeFalsy();
    expect(tree.exists('apps/test_api/tests/test_hello.py')).toBeFalsy();
  });

  it('should set up project configuration with FastAPI targets', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test_api/project.json', 'utf-8'),
    );

    // Verify FastAPI-specific targets
    expect(projectConfig.targets.bundle).toBeDefined();
    expect(projectConfig.targets.bundle.outputs).toEqual([
      '{workspaceRoot}/dist/apps/test_api/bundle',
    ]);
    expect(projectConfig.targets.bundle.options.commands).toContain(
      'uv export --frozen --no-dev --no-editable --project test_api -o dist/apps/test_api/bundle/requirements.txt',
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
      'uv run fastapi dev test_api/main.py --port 8000',
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
    });

    const pyprojectToml = parse(
      tree.read('apps/test_api/pyproject.toml', 'utf-8'),
    ) as UVPyprojectToml;

    // Verify FastAPI dependencies
    expect(pyprojectToml.project.dependencies).toContain('fastapi');
    expect(pyprojectToml.project.dependencies).toContain('mangum');
    expect(pyprojectToml['dependency-groups'].dev).toContain(
      'fastapi[standard]>=0.115',
    );
  });

  it('should set up shared constructs for http', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps/nested/path',
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
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
  });

  it('should set up shared constructs for rest', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps/nested/path',
      computeType: 'ServerlessApiGatewayRestApi',
      auth: 'IAM',
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
  });

  it('should update shared constructs build dependencies', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
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
    });

    expect(tree.exists('apps/nested/path/test_api')).toBeTruthy();
    expect(
      tree.exists('apps/nested/path/test_api/test_api/main.py'),
    ).toBeTruthy();
  });

  it('should set project metadata', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
    });

    const config = JSON.parse(tree.read('apps/test_api/project.json', 'utf-8'));
    // Verify project metadata
    expect(config.metadata).toEqual({
      apiName: 'test-api',
      apiType: 'fast-api',
      auth: 'IAM',
      generator: FAST_API_GENERATOR_INFO.id,
      port: 8000,
    });
  });

  it('should match snapshot', async () => {
    await pyFastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
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
      });

      // Read the generated init.py file
      const initPyContent = tree.read(
        'apps/test_api/test_api/init.py',
        'utf-8',
      );

      // Verify CORS middleware import is included
      expect(initPyContent).toContain(
        'from fastapi.middleware.cors import CORSMiddleware',
      );

      // Verify CORS middleware is added with correct configuration
      expect(initPyContent).toContain('app.add_middleware(CORSMiddleware,');
    },
  );

  it('should increment ports when running generator multiple times', async () => {
    // Generate first API
    await pyFastApiProjectGenerator(tree, {
      name: 'first-api',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
    });

    // Generate second API
    await pyFastApiProjectGenerator(tree, {
      name: 'second-api',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
    });

    // Generate third API
    await pyFastApiProjectGenerator(tree, {
      name: 'third-api',
      directory: 'apps',
      computeType: 'ServerlessApiGatewayHttpApi',
      auth: 'IAM',
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

    expect(firstApiConfig.metadata.port).toBe(8000);
    expect(secondApiConfig.metadata.port).toBe(8001);
    expect(thirdApiConfig.metadata.port).toBe(8002);

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
});
