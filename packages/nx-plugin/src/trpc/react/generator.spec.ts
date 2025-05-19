/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { TRPC_REACT_GENERATOR_INFO, reactGenerator } from './generator';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { expectHasMetricTags } from '../../utils/metrics.spec';

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

  it('should generate trpc react files', async () => {
    await reactGenerator(tree, {
      frontendProjectName: 'frontend',
      backendProjectName: 'backend',
      auth: 'None',
    });
    // Verify generated files
    expect(
      tree.exists('apps/frontend/src/components/TrpcClients/index.tsx'),
    ).toBeTruthy();
    expect(tree.exists('apps/frontend/src/hooks/useTestApi.tsx')).toBeTruthy();
    // Create snapshots of generated files
    expect(
      tree.read('apps/frontend/src/hooks/useTestApi.tsx', 'utf-8'),
    ).toMatchSnapshot('useTestApi.tsx');
    expect(
      tree.read('apps/frontend/src/components/TrpcClients/index.tsx', 'utf-8'),
    ).toMatchSnapshot('TrpcClients-index.tsx');
    expect(
      tree.read(
        'apps/frontend/src/components/TrpcClients/TrpcProvider.tsx',
        'utf-8',
      ),
    ).toMatchSnapshot('TrpcClients-TrpcProvider.tsx');
    expect(
      tree.read(
        'apps/frontend/src/components/TrpcClients/TrpcApis.tsx',
        'utf-8',
      ),
    ).toMatchSnapshot('TrpcClients-TrpcApis.tsx');
    expect(
      tree.read(
        'apps/frontend/src/components/TrpcClients/TrpcClientProviders.tsx',
        'utf-8',
      ),
    ).toMatchSnapshot('TrpcClients-TrpcClientProviders.tsx');
  });

  it('should modify main.tsx correctly', async () => {
    await reactGenerator(tree, {
      frontendProjectName: 'frontend',
      backendProjectName: 'backend',
      auth: 'None',
    });
    const mainTsxContent = tree.read('apps/frontend/src/main.tsx', 'utf-8');
    // Create snapshot of modified main.tsx
    expect(mainTsxContent).toMatchSnapshot('main.tsx');
  });

  it('should add required dependencies', async () => {
    await reactGenerator(tree, {
      frontendProjectName: 'frontend',
      backendProjectName: 'backend',
      auth: 'None',
    });
    const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    // Verify dependencies were added
    expect(
      packageJson.dependencies['@trpc/tanstack-react-query'],
    ).toBeDefined();
    expect(packageJson.dependencies['@tanstack/react-query']).toBeDefined();
  });

  it('should handle IAM auth option', async () => {
    await reactGenerator(tree, {
      frontendProjectName: 'frontend',
      backendProjectName: 'backend',
      auth: 'IAM',
    });
    const trpcProviderContent = tree.read(
      'apps/frontend/src/components/TRPCClientProvider/index.tsx',
      'utf-8',
    );
    expect(trpcProviderContent).toMatchSnapshot('TRPCClientProvider-IAM.tsx');

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

  it('should add generator metric to app.ts', async () => {
    await sharedConstructsGenerator(tree);

    // Call the generator function
    await reactGenerator(tree, {
      frontendProjectName: 'frontend',
      backendProjectName: 'backend',
      auth: 'None',
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
    await reactGenerator(tree, {
      frontendProjectName: 'frontend', // Unqualified name (without @my-scope/)
      backendProjectName: '@my-scope/backend', // Fully qualified name
      auth: 'None',
    });

    // Verify files were generated
    expect(
      tree.exists('apps/frontend/src/components/TrpcClients/index.tsx'),
    ).toBeTruthy();
    expect(tree.exists('apps/frontend/src/hooks/useTestApi.tsx')).toBeTruthy();
  });

  it('should work with unqualified backend project name', async () => {
    await reactGenerator(tree, {
      frontendProjectName: '@my-scope/frontend', // Fully qualified name
      backendProjectName: 'backend', // Unqualified name (without @my-scope/)
      auth: 'None',
    });

    // Verify files were generated
    expect(
      tree.exists('apps/frontend/src/components/TrpcClients/index.tsx'),
    ).toBeTruthy();
    expect(tree.exists('apps/frontend/src/hooks/useTestApi.tsx')).toBeTruthy();
  });

  it('should work with both unqualified project names', async () => {
    await reactGenerator(tree, {
      frontendProjectName: 'frontend', // Unqualified name (without @my-scope/)
      backendProjectName: 'backend', // Unqualified name (without @my-scope/)
      auth: 'None',
    });

    // Verify files were generated
    expect(
      tree.exists('apps/frontend/src/components/TrpcClients/index.tsx'),
    ).toBeTruthy();
    expect(tree.exists('apps/frontend/src/hooks/useTestApi.tsx')).toBeTruthy();
  });
});
