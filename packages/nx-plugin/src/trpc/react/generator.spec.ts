/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree, updateJson } from '@nx/devkit';
import { TRPC_REACT_GENERATOR_INFO, reactGenerator } from './generator';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import { tsCloudScapeWebsiteGenerator } from '../../cloudscape-website/app/generator';
import { tsTrpcApiGenerator } from '../backend/generator';

describe('trpc react generator', () => {
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
    // Mock backend project configuration
    tree.write(
      'apps/backend/project.json',
      JSON.stringify({
        name: 'backend',
        root: 'apps/backend',
        sourceRoot: 'apps/backend/src',
        metadata: {
          apiName: 'TestApi',
          auth: 'None',
        },
      }),
    );
    // Mock main.tsx file
    tree.write(
      'apps/frontend/src/main.tsx',
      `
import { RouterProvider } from '@tanstack/react-router';

const App = () => <RouterProvider router={router} />;

export function Main() {
  return <App />;
}
`,
    );
  });

  it('should generate trpc react files', async () => {
    await reactGenerator(tree, {
      frontendProjectName: 'frontend',
      backendProjectName: 'backend',
    });
    // Verify generated files
    expect(
      tree.exists('apps/frontend/src/components/TestApiClientProvider.tsx'),
    ).toBeTruthy();

    expect(
      tree.read(
        'apps/frontend/src/components/TestApiClientProvider.tsx',
        'utf-8',
      ),
    ).toMatchSnapshot('TestApiClientProvider.tsx');

    expect(tree.exists('apps/frontend/src/hooks/useTestApi.tsx')).toBeTruthy();
    expect(
      tree.read('apps/frontend/src/hooks/useTestApi.tsx', 'utf-8'),
    ).toMatchSnapshot('useTestApi.tsx');
  });

  it('should modify main.tsx correctly', async () => {
    await reactGenerator(tree, {
      frontendProjectName: 'frontend',
      backendProjectName: 'backend',
    });
    const mainTsxContent = tree.read('apps/frontend/src/main.tsx', 'utf-8');
    // Create snapshot of modified main.tsx
    expect(mainTsxContent).toMatchSnapshot('main.tsx');
  });

  it('should add required dependencies', async () => {
    await reactGenerator(tree, {
      frontendProjectName: 'frontend',
      backendProjectName: 'backend',
    });
    const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    // Verify dependencies were added
    expect(
      packageJson.dependencies['@trpc/tanstack-react-query'],
    ).toBeDefined();
    expect(packageJson.dependencies['@tanstack/react-query']).toBeDefined();
  });

  it('should handle IAM auth option', async () => {
    updateJson(tree, 'apps/backend/project.json', (config) => ({
      ...config,
      metadata: {
        ...config.metadata,
        auth: 'IAM',
      },
    }));

    await reactGenerator(tree, {
      frontendProjectName: 'frontend',
      backendProjectName: 'backend',
    });

    expect(
      tree.read(
        'apps/frontend/src/components/TestApiClientProvider.tsx',
        'utf-8',
      ),
    ).toMatchSnapshot('TestApiClientProvider-IAM.tsx');

    expect(tree.exists('apps/frontend/src/hooks/useSigV4.tsx')).toBeTruthy();
    expect(
      tree.read('apps/frontend/src/hooks/useSigV4.tsx', 'utf-8'),
    ).toMatchSnapshot('useSigV4.tsx');

    const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    // Verify dependencies were added
    expect(
      packageJson.dependencies['@trpc/tanstack-react-query'],
    ).toBeDefined();
    expect(packageJson.dependencies['@tanstack/react-query']).toBeDefined();
    expect(packageJson.dependencies['oidc-client-ts']).toBeDefined();
    expect(packageJson.dependencies['react-oidc-context']).toBeDefined();
    expect(
      packageJson.dependencies['@aws-sdk/client-cognito-identity'],
    ).toBeDefined();
    expect(
      packageJson.dependencies['@aws-sdk/credential-provider-cognito-identity'],
    ).toBeDefined();
    expect(packageJson.dependencies['aws4fetch']).toBeDefined();
  });

  it('should handle Cognito auth option', async () => {
    updateJson(tree, 'apps/backend/project.json', (config) => ({
      ...config,
      metadata: {
        ...config.metadata,
        auth: 'Cognito',
      },
    }));

    await reactGenerator(tree, {
      frontendProjectName: 'frontend',
      backendProjectName: 'backend',
    });

    expect(
      tree.read(
        'apps/frontend/src/components/TestApiClientProvider.tsx',
        'utf-8',
      ),
    ).toMatchSnapshot('TestApiClientProvider-Cognito.tsx');

    expect(tree.exists('apps/frontend/src/hooks/useSigV4.tsx')).toBeFalsy();

    const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    // Verify dependencies were added
    expect(
      packageJson.dependencies['@trpc/tanstack-react-query'],
    ).toBeDefined();
    expect(packageJson.dependencies['@tanstack/react-query']).toBeDefined();
    expect(packageJson.dependencies['react-oidc-context']).toBeDefined();
  });

  it('should add generator metric to app.ts', async () => {
    await sharedConstructsGenerator(tree);

    // Call the generator function
    await reactGenerator(tree, {
      frontendProjectName: 'frontend',
      backendProjectName: 'backend',
    });

    // Verify the metric was added to app.ts
    expectHasMetricTags(tree, TRPC_REACT_GENERATOR_INFO.metric);
  });
});

describe('trpc react generator with unqualified names', () => {
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

    // Mock backend project configuration with TypeScript fully qualified name
    tree.write(
      'apps/backend/project.json',
      JSON.stringify({
        name: '@my-scope/backend',
        root: 'apps/backend',
        sourceRoot: 'apps/backend/src',
        metadata: {
          apiName: 'TestApi',
          auth: 'None',
        },
      }),
    );

    // Mock main.tsx file
    tree.write(
      'apps/frontend/src/main.tsx',
      `
import { RouterProvider } from '@tanstack/react-router';

const App = () => <RouterProvider router={router} />;

export function Main() {
  return <App />;
}
`,
    );
  });

  it('should work with unqualified frontend project name', async () => {
    await reactGenerator(tree, {
      frontendProjectName: 'frontend', // Unqualified name (without @my-scope/)
      backendProjectName: '@my-scope/backend', // Fully qualified name
    });

    // Verify files were generated
    expect(
      tree.exists('apps/frontend/src/components/TestApiClientProvider.tsx'),
    ).toBeTruthy();
    expect(tree.exists('apps/frontend/src/hooks/useTestApi.tsx')).toBeTruthy();
  });

  it('should work with unqualified backend project name', async () => {
    await reactGenerator(tree, {
      frontendProjectName: '@my-scope/frontend', // Fully qualified name
      backendProjectName: 'backend', // Unqualified name (without @my-scope/)
    });

    // Verify files were generated
    expect(
      tree.exists('apps/frontend/src/components/TestApiClientProvider.tsx'),
    ).toBeTruthy();
    expect(tree.exists('apps/frontend/src/hooks/useTestApi.tsx')).toBeTruthy();
  });

  it('should work with both unqualified project names', async () => {
    await reactGenerator(tree, {
      frontendProjectName: 'frontend', // Unqualified name (without @my-scope/)
      backendProjectName: 'backend', // Unqualified name (without @my-scope/)
    });

    // Verify files were generated
    expect(
      tree.exists('apps/frontend/src/components/TestApiClientProvider.tsx'),
    ).toBeTruthy();
    expect(tree.exists('apps/frontend/src/hooks/useTestApi.tsx')).toBeTruthy();
  });
});

describe('trpc react generator with real react and trpc projects', () => {
  let tree: Tree;

  beforeEach(async () => {
    tree = createTreeUsingTsSolutionSetup();

    // Generate a cloudscape website
    await tsCloudScapeWebsiteGenerator(tree, {
      name: 'frontend',
      skipInstall: true,
    });
  });

  it('should configure serve-local integration with generated projects', async () => {
    // Generate a trpc backend
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      auth: 'None',
      computeType: 'ServerlessApiGatewayHttpApi',
    });

    await reactGenerator(tree, {
      frontendProjectName: 'frontend',
      backendProjectName: 'test-api',
    });

    // Read the frontend project configuration
    const frontendProject = JSON.parse(
      tree.read('frontend/project.json', 'utf-8'),
    );

    // Verify that serve-local target now depends on backend serve target
    expect(frontendProject.targets['serve-local'].dependsOn).toContainEqual({
      projects: ['@proj/test-api'],
      target: 'serve',
    });

    // Verify that the runtime config was created and modified
    expect(
      tree.exists('frontend/src/components/RuntimeConfig/index.tsx'),
    ).toBeTruthy();

    const runtimeConfigContent = tree.read(
      'frontend/src/components/RuntimeConfig/index.tsx',
      'utf-8',
    );

    // Verify that the runtime config includes the API override
    expect(runtimeConfigContent).toContain('runtimeConfig.apis.TestApi');
    expect(runtimeConfigContent).toContain('http://localhost:2022/');
  });

  it('should use correct port numbers in runtime config overrides', async () => {
    // Generate first API
    await tsTrpcApiGenerator(tree, {
      name: 'FirstApi',
      auth: 'None',
      computeType: 'ServerlessApiGatewayHttpApi',
    });

    // Generate second API
    await tsTrpcApiGenerator(tree, {
      name: 'SecondApi',
      auth: 'None',
      computeType: 'ServerlessApiGatewayHttpApi',
    });

    // Connect first API to frontend
    await reactGenerator(tree, {
      frontendProjectName: 'frontend',
      backendProjectName: 'first-api',
    });

    // Connect second API to frontend
    await reactGenerator(tree, {
      frontendProjectName: 'frontend',
      backendProjectName: 'second-api',
    });

    // Verify that the runtime config includes the correct port overrides
    const runtimeConfigContent = tree.read(
      'frontend/src/components/RuntimeConfig/index.tsx',
      'utf-8',
    );

    expect(runtimeConfigContent).toContain('runtimeConfig.apis.FirstApi');
    expect(runtimeConfigContent).toContain('http://localhost:2022/');
    expect(runtimeConfigContent).toContain('runtimeConfig.apis.SecondApi');
    expect(runtimeConfigContent).toContain('http://localhost:2023/');
  });
});
