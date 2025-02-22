/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { fastApiReactGenerator } from './generator';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';

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
      'nx g @aws/nx-plugin:open-api#ts-client --openApiSpecPath="dist/apps/backend/openapi/openapi.json" --outputPath="apps/frontend/src/generated/test-api" --no-interactive',
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
  });

  it('should generate client hook', async () => {
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

    // Create snapshot of generated hook with IAM auth
    expect(
      tree.read('apps/frontend/src/hooks/useTestApi.tsx', 'utf-8'),
    ).toMatchSnapshot('useTestApi-IAM.tsx');
  });
});
