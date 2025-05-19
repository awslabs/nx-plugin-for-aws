/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import {
  FAST_API_REACT_GENERATOR_INFO,
  fastApiReactGenerator,
} from './generator';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import { query } from '../../../utils/ast';
import { sharedConstructsGenerator } from '../../../utils/shared-constructs';
import { expectHasMetricTags } from '../../../utils/metrics.spec';

describe('fastapi react generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();

    // Mock frontend project configuration
    tree.write(
      'apps/frontend/project.json',
      JSON.stringify({
        name: 'frontend',
        root: 'apps/frontend',
        sourceRoot: 'apps/frontend/src',
      }),
    );
    // Mock FastAPI project configuration
    tree.write(
      'apps/backend/project.json',
      JSON.stringify({
        name: 'backend',
        root: 'apps/backend',
        sourceRoot: 'apps/backend/src',
        metadata: {
          apiName: 'TestApi',
        },
      }),
    );
    // Mock main.tsx file
    tree.write(
      'apps/frontend/src/main.tsx',
      `
import { App } from './app';
import { RouterProvider } from '@tanstack/react-router';

export function Main() {
  return <RouterProvider router={router} />;
}
`,
    );
  });

  it('should generate OpenAPI spec script', async () => {
    await fastApiReactGenerator(tree, {
      frontendProjectName: 'frontend',
      fastApiProjectName: 'backend',
      auth: 'None',
    });

    // Verify OpenAPI spec generation script was created
    expect(
      tree.exists('apps/backend/scripts/generate_open_api.py'),
    ).toBeTruthy();

    // Create snapshot of generated script
    expect(
      tree.read('apps/backend/scripts/generate_open_api.py', 'utf-8'),
    ).toMatchSnapshot('generate_open_api.py');
  });

  it('should update FastAPI project configuration', async () => {
    await fastApiReactGenerator(tree, {
      frontendProjectName: 'frontend',
      fastApiProjectName: 'backend',
      auth: 'None',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/backend/project.json', 'utf-8'),
    );

    // Verify openapi target was added
    expect(projectConfig.targets.openapi).toBeDefined();
    expect(projectConfig.targets.openapi.executor).toBe('nx:run-commands');
    expect(projectConfig.targets.openapi.outputs).toEqual([
      '{workspaceRoot}/dist/apps/backend/openapi',
    ]);

    // Verify build target was updated to depend on openapi
    expect(projectConfig.targets.build.dependsOn).toContain('openapi');
  });

  it('should update frontend project configuration', async () => {
    await fastApiReactGenerator(tree, {
      frontendProjectName: 'frontend',
      fastApiProjectName: 'backend',
      auth: 'None',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/frontend/project.json', 'utf-8'),
    );

    // Verify client generation target was added
    expect(projectConfig.targets['generate:test-api-client']).toBeDefined();
    expect(projectConfig.targets['generate:test-api-client'].executor).toBe(
      'nx:run-commands',
    );

    expect(
      projectConfig.targets['generate:test-api-client'].options.commands,
    ).toEqual([
      'nx g @aws/nx-plugin:open-api#ts-hooks --openApiSpecPath="dist/apps/backend/openapi/openapi.json" --outputPath="apps/frontend/src/generated/test-api" --no-interactive',
    ]);

    expect(
      projectConfig.targets['generate:test-api-client'].dependsOn,
    ).toContain('backend:openapi');

    // Verify generated client is ignored by default
    expect(tree.exists('apps/frontend/.gitignore'));
    expect(tree.read('apps/frontend/.gitignore', 'utf-8')).toContain(
      'src/generated/test-api',
    );

    // Verify compile target depends on client generation
    expect(projectConfig.targets.compile.dependsOn).toContain(
      'generate:test-api-client',
    );

    // Verify bundle target depends on client generation
    expect(projectConfig.targets.bundle.dependsOn).toContain(
      'generate:test-api-client',
    );
  });

  it('should generate vanilla client hook', async () => {
    await fastApiReactGenerator(tree, {
      frontendProjectName: 'frontend',
      fastApiProjectName: 'backend',
      auth: 'None',
    });

    // Verify hook file was created
    expect(
      tree.exists('apps/frontend/src/hooks/useTestApiClient.tsx'),
    ).toBeTruthy();

    // Create snapshot of generated hook
    expect(
      tree.read('apps/frontend/src/hooks/useTestApiClient.tsx', 'utf-8'),
    ).toMatchSnapshot('useTestApiClient.tsx');
  });

  it('should generate tanstack query options proxy hook', async () => {
    await fastApiReactGenerator(tree, {
      frontendProjectName: 'frontend',
      fastApiProjectName: 'backend',
      auth: 'None',
    });

    // Verify hook file was created
    expect(tree.exists('apps/frontend/src/hooks/useTestApi.tsx')).toBeTruthy();

    // Create snapshot of generated hook
    expect(
      tree.read('apps/frontend/src/hooks/useTestApi.tsx', 'utf-8'),
    ).toMatchSnapshot('useTestApi.tsx');
  });

  it('should generate tanstack query options proxy provider', async () => {
    await fastApiReactGenerator(tree, {
      frontendProjectName: 'frontend',
      fastApiProjectName: 'backend',
      auth: 'None',
    });

    // Verify providers were created
    expect(
      tree.exists('apps/frontend/src/components/QueryClientProvider.tsx'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/frontend/src/components/TestApiProvider.tsx'),
    ).toBeTruthy();

    // Create snapshot of generated provider
    expect(
      tree.read('apps/frontend/src/components/TestApiProvider.tsx', 'utf-8'),
    ).toMatchSnapshot('TestApiProvider.tsx');
  });

  it('should instrument providers in main.tsx', async () => {
    await fastApiReactGenerator(tree, {
      frontendProjectName: 'frontend',
      fastApiProjectName: 'backend',
      auth: 'None',
    });

    expect(
      query(
        tree,
        'apps/frontend/src/main.tsx',
        'JsxOpeningElement[tagName.name="QueryClientProvider"]',
      ),
    ).toHaveLength(1);

    expect(
      query(
        tree,
        'apps/frontend/src/main.tsx',
        'JsxOpeningElement[tagName.name="TestApiProvider"]',
      ),
    ).toHaveLength(1);

    expect(tree.read('apps/frontend/src/main.tsx', 'utf-8')).toMatchSnapshot(
      'main.tsx',
    );
  });

  it('should not duplicate providers in main.tsx', async () => {
    // Generate twice
    await fastApiReactGenerator(tree, {
      frontendProjectName: 'frontend',
      fastApiProjectName: 'backend',
      auth: 'None',
    });

    await fastApiReactGenerator(tree, {
      frontendProjectName: 'frontend',
      fastApiProjectName: 'backend',
      auth: 'None',
    });

    // Check that there is still only a single QueryClientProvider
    expect(
      query(
        tree,
        'apps/frontend/src/main.tsx',
        'JsxOpeningElement[tagName.name="QueryClientProvider"]',
      ),
    ).toHaveLength(1);

    // Check that there is still only a single TestApiProvider
    expect(
      query(
        tree,
        'apps/frontend/src/main.tsx',
        'JsxOpeningElement[tagName.name="TestApiProvider"]',
      ),
    ).toHaveLength(1);
  });

  it('should handle IAM auth option', async () => {
    await fastApiReactGenerator(tree, {
      frontendProjectName: 'frontend',
      fastApiProjectName: 'backend',
      auth: 'IAM',
    });

    // Verify sigv4 hook was added
    expect(tree.exists('apps/frontend/src/hooks/useSigV4.tsx')).toBeTruthy();

    // Verify IAM-specific dependencies were added
    const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    expect(packageJson.dependencies['oidc-client-ts']).toBeDefined();
    expect(packageJson.dependencies['react-oidc-context']).toBeDefined();
    expect(
      packageJson.dependencies['@aws-sdk/client-cognito-identity'],
    ).toBeDefined();
    expect(
      packageJson.dependencies['@aws-sdk/credential-provider-cognito-identity'],
    ).toBeDefined();
    expect(packageJson.dependencies['aws4fetch']).toBeDefined();

    // Create snapshot of generated provider with IAM auth
    expect(
      tree.read('apps/frontend/src/components/TestApiProvider.tsx', 'utf-8'),
    ).toMatchSnapshot('TestApiProvider-IAM.tsx');
  });

  it('should add generator metric to app.ts', async () => {
    // Set up test tree with shared constructs
    await sharedConstructsGenerator(tree);

    // Call the generator function
    await fastApiReactGenerator(tree, {
      frontendProjectName: 'frontend',
      fastApiProjectName: 'backend',
      auth: 'None',
    });

    // Verify the metric was added to app.ts
    expectHasMetricTags(tree, FAST_API_REACT_GENERATOR_INFO.metric);
  });
});

describe('fastapi react generator with unqualified names', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();

    // Setup package.json with a scope
    tree.write(
      'package.json',
      JSON.stringify({
        name: '@my-scope/monorepo',
        version: '1.0.0',
      }),
    );

    // Mock frontend project configuration with TypeScript fully qualified name
    tree.write(
      'apps/frontend/project.json',
      JSON.stringify({
        name: '@my-scope/frontend',
        root: 'apps/frontend',
        sourceRoot: 'apps/frontend/src',
      }),
    );

    // Mock FastAPI project configuration with Python fully qualified name
    tree.write(
      'apps/backend/project.json',
      JSON.stringify({
        name: 'my_scope.backend',
        root: 'apps/backend',
        sourceRoot: 'apps/backend/src',
        metadata: {
          apiName: 'TestApi',
        },
      }),
    );

    // Mock main.tsx file
    tree.write(
      'apps/frontend/src/main.tsx',
      `
import { App } from './app';
import { RouterProvider } from '@tanstack/react-router';

export function Main() {
  return <RouterProvider router={router} />;
}
`,
    );
  });

  it('should work with unqualified frontend project name', async () => {
    await fastApiReactGenerator(tree, {
      frontendProjectName: 'frontend', // Unqualified name (without @my-scope/)
      fastApiProjectName: 'my_scope.backend', // Fully qualified name
      auth: 'None',
    });

    // Verify OpenAPI spec generation script was created
    expect(
      tree.exists('apps/backend/scripts/generate_open_api.py'),
    ).toBeTruthy();

    // Verify frontend project configuration was updated
    const projectConfig = JSON.parse(
      tree.read('apps/frontend/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['generate:test-api-client']).toBeDefined();
    expect(
      projectConfig.targets['generate:test-api-client'].dependsOn,
    ).toContain('my_scope.backend:openapi');
  });

  it('should work with unqualified FastAPI project name', async () => {
    await fastApiReactGenerator(tree, {
      frontendProjectName: '@my-scope/frontend', // Fully qualified name
      fastApiProjectName: 'backend', // Unqualified name (without my_scope.)
      auth: 'None',
    });

    // Verify OpenAPI spec generation script was created
    expect(
      tree.exists('apps/backend/scripts/generate_open_api.py'),
    ).toBeTruthy();

    // Verify frontend project configuration was updated
    const projectConfig = JSON.parse(
      tree.read('apps/frontend/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['generate:test-api-client']).toBeDefined();
    expect(
      projectConfig.targets['generate:test-api-client'].dependsOn,
    ).toContain('my_scope.backend:openapi');
  });

  it('should work with both unqualified project names', async () => {
    await fastApiReactGenerator(tree, {
      frontendProjectName: 'frontend', // Unqualified name (without @my-scope/)
      fastApiProjectName: 'backend', // Unqualified name (without my_scope.)
      auth: 'None',
    });

    // Verify OpenAPI spec generation script was created
    expect(
      tree.exists('apps/backend/scripts/generate_open_api.py'),
    ).toBeTruthy();

    // Verify frontend project configuration was updated
    const projectConfig = JSON.parse(
      tree.read('apps/frontend/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['generate:test-api-client']).toBeDefined();
    expect(
      projectConfig.targets['generate:test-api-client'].dependsOn,
    ).toContain('my_scope.backend:openapi');
  });
});
