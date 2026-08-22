/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type Tree, updateJson } from '@nx/devkit';
import { tsReactWebsiteGenerator } from '../../ts/react-website/app/generator';
import { declareDependencies } from '../../utils/declared-dependencies';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../utils/shared-constructs';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { tsTrpcApiGenerator } from '../backend/generator';
import { reactGenerator, TRPC_REACT_GENERATOR_INFO } from './generator';

const sharedConstructsDeclaration = declareDependencies()({
  ts: [...SHARED_CONSTRUCTS_DEPENDENCIES],
});

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
    tree.write(
      'apps/frontend/package.json',
      JSON.stringify({ name: '@proj/frontend', type: 'module' }),
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
          auth: 'custom',
        },
      }),
    );
    tree.write(
      'apps/backend/package.json',
      JSON.stringify({ name: '@proj/backend', type: 'module' }),
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
    const packageJson = JSON.parse(
      tree.read('apps/frontend/package.json', 'utf-8'),
    );
    // Verify dependencies were added to the frontend project manifest
    expect(packageJson.dependencies['@trpc/tanstack-react-query']).toBe(
      'catalog:',
    );
    expect(packageJson.dependencies['@tanstack/react-query']).toBe('catalog:');
    expect(packageJson.dependencies['@tanstack/react-query-devtools']).toBe(
      'catalog:',
    );
  });

  it('should handle IAM auth option', async () => {
    updateJson(tree, 'apps/backend/project.json', (config) => ({
      ...config,
      metadata: {
        ...config.metadata,
        auth: 'iam',
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

    const packageJson = JSON.parse(
      tree.read('apps/frontend/package.json', 'utf-8'),
    );
    // Verify dependencies were added to the frontend project manifest
    expect(packageJson.dependencies['@trpc/tanstack-react-query']).toBe(
      'catalog:',
    );
    expect(packageJson.dependencies['@tanstack/react-query']).toBe('catalog:');
    expect(packageJson.dependencies['@tanstack/react-query-devtools']).toBe(
      'catalog:',
    );
    expect(packageJson.dependencies['oidc-client-ts']).toBe('catalog:');
    expect(packageJson.dependencies['react-oidc-context']).toBe('catalog:');
    expect(
      packageJson.dependencies['@aws-sdk/credential-provider-cognito-identity'],
    ).toBe('catalog:');
    expect(packageJson.dependencies['aws4fetch']).toBe('catalog:');
  });

  it('should handle Cognito auth option', async () => {
    updateJson(tree, 'apps/backend/project.json', (config) => ({
      ...config,
      metadata: {
        ...config.metadata,
        auth: 'cognito',
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

    const packageJson = JSON.parse(
      tree.read('apps/frontend/package.json', 'utf-8'),
    );
    // Verify dependencies were added to the frontend project manifest
    expect(packageJson.dependencies['@trpc/tanstack-react-query']).toBe(
      'catalog:',
    );
    expect(packageJson.dependencies['@tanstack/react-query']).toBe('catalog:');
    expect(packageJson.dependencies['@tanstack/react-query-devtools']).toBe(
      'catalog:',
    );
    expect(packageJson.dependencies['react-oidc-context']).toBe('catalog:');
  });

  it('should add generator metric to app.ts', async () => {
    await sharedConstructsGenerator(
      tree,
      { iac: 'cdk' },
      sharedConstructsDeclaration,
    );

    // Call the generator function
    await reactGenerator(tree, {
      frontendProjectName: 'frontend',
      backendProjectName: 'backend',
    });

    // Verify the metric was added to app.ts
    expectHasMetricTags(tree, TRPC_REACT_GENERATOR_INFO.metric);
  });
  describe('REST API (rest-lambda)', () => {
    beforeEach(() => {
      updateJson(tree, 'apps/backend/project.json', (config) => ({
        ...config,
        metadata: {
          ...config.metadata,
          infra: 'rest-lambda',
        },
      }));
    });

    it('should generate REST API client provider with splitLink for Custom auth', async () => {
      await reactGenerator(tree, {
        frontendProjectName: 'frontend',
        backendProjectName: 'backend',
      });

      expect(
        tree.read(
          'apps/frontend/src/components/TestApiClientProvider.tsx',
          'utf-8',
        ),
      ).toMatchSnapshot('TestApiClientProvider-REST-Custom.tsx');

      // Custom auth still uses EventSourcePolyfill for subscription support
      const packageJson = JSON.parse(
        tree.read('apps/frontend/package.json', 'utf-8'),
      );
      expect(packageJson.dependencies['event-source-polyfill']).toBe(
        'catalog:',
      );
    });

    it('should generate REST API client provider with splitLink for IAM auth', async () => {
      updateJson(tree, 'apps/backend/project.json', (config) => ({
        ...config,
        metadata: {
          ...config.metadata,
          auth: 'iam',
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
      ).toMatchSnapshot('TestApiClientProvider-REST-IAM.tsx');

      const packageJson = JSON.parse(
        tree.read('apps/frontend/package.json', 'utf-8'),
      );
      expect(packageJson.dependencies['event-source-polyfill']).toBe(
        'catalog:',
      );
      expect(packageJson.devDependencies['@types/event-source-polyfill']).toBe(
        'catalog:',
      );
      expect(packageJson.dependencies['aws4fetch']).toBe('catalog:');
    });

    it('should generate REST API client provider with splitLink for Cognito auth', async () => {
      updateJson(tree, 'apps/backend/project.json', (config) => ({
        ...config,
        metadata: {
          ...config.metadata,
          auth: 'cognito',
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
      ).toMatchSnapshot('TestApiClientProvider-REST-Cognito.tsx');

      const packageJson = JSON.parse(
        tree.read('apps/frontend/package.json', 'utf-8'),
      );
      expect(packageJson.dependencies['event-source-polyfill']).toBe(
        'catalog:',
      );
      expect(packageJson.devDependencies['@types/event-source-polyfill']).toBe(
        'catalog:',
      );
      expect(packageJson.dependencies['react-oidc-context']).toBe('catalog:');
    });

    it('should not add event-source-polyfill for HTTP API', async () => {
      updateJson(tree, 'apps/backend/project.json', (config) => ({
        ...config,
        metadata: {
          ...config.metadata,
          infra: 'http-lambda',
        },
      }));

      await reactGenerator(tree, {
        frontendProjectName: 'frontend',
        backendProjectName: 'backend',
      });

      const packageJson = JSON.parse(
        tree.read('apps/frontend/package.json', 'utf-8'),
      );
      expect(packageJson.dependencies['event-source-polyfill']).toBeUndefined();
      expect(
        packageJson.devDependencies?.['@types/event-source-polyfill'],
      ).toBeUndefined();
    });
  });

  describe('AgentCore Harness AG-UI connection', () => {
    beforeEach(() => {
      // Mirrors what `agentcore-harness#trpc-connection` records on the API
      // project once it has wired a `/agui` route (see
      // agentcore-harness/trpc-connection/generator.ts).
      updateJson(tree, 'apps/backend/project.json', (config) => ({
        ...config,
        metadata: {
          ...config.metadata,
          infra: 'rest-lambda',
          components: [
            {
              generator: 'agentcore-harness#trpc-connection',
              name: 'MyHarness',
              path: 'packages/common/constructs/src/app/harnesses/my-harness',
            },
          ],
        },
      }));
    });

    it('wires a stock HttpAgent at the API /agui route for IAM auth', async () => {
      updateJson(tree, 'apps/backend/project.json', (config) => ({
        ...config,
        metadata: { ...config.metadata, auth: 'iam' },
      }));

      await reactGenerator(tree, {
        frontendProjectName: 'frontend',
        backendProjectName: 'backend',
      });

      expect(
        tree.exists('apps/frontend/src/hooks/useAguiMyHarness.tsx'),
      ).toBeTruthy();
      expect(
        tree.read('apps/frontend/src/hooks/useAguiMyHarness.tsx', 'utf-8'),
      ).toMatchSnapshot('useAguiMyHarness-IAM.tsx');

      // The AG-UI provider/theme/registration wiring is unchanged from the
      // agent-runtime path.
      expect(
        tree.read('apps/frontend/src/components/AguiProvider.tsx', 'utf-8'),
      ).toContain('myHarnessAgents');

      const packageJson = JSON.parse(
        tree.read('apps/frontend/package.json', 'utf-8'),
      );
      expect(packageJson.dependencies['@copilotkit/react-core']).toBe(
        'catalog:',
      );
      expect(packageJson.dependencies['@ag-ui/client']).toBe('catalog:');
    });

    it('wires a stock HttpAgent at the API /agui route for Cognito auth', async () => {
      updateJson(tree, 'apps/backend/project.json', (config) => ({
        ...config,
        metadata: { ...config.metadata, auth: 'cognito' },
      }));

      await reactGenerator(tree, {
        frontendProjectName: 'frontend',
        backendProjectName: 'backend',
      });

      expect(
        tree.read('apps/frontend/src/hooks/useAguiMyHarness.tsx', 'utf-8'),
      ).toMatchSnapshot('useAguiMyHarness-Cognito.tsx');
    });

    it('hydrates the thread from `history` on mount and re-hydrates when a run finalizes', async () => {
      updateJson(tree, 'apps/backend/project.json', (config) => ({
        ...config,
        metadata: { ...config.metadata, auth: 'iam' },
      }));

      await reactGenerator(tree, {
        frontendProjectName: 'frontend',
        backendProjectName: 'backend',
      });

      const hook = tree.read(
        'apps/frontend/src/hooks/useAguiMyHarness.tsx',
        'utf-8',
      );

      // Hydrates on mount...
      expect(hook).toContain('historyClient.history.query');
      expect(hook).toContain('agent.setMessages');
      expect(hook).toContain('rehydrate();');
      // ...and again after every run finalizes (success, error, or a dropped
      // SSE connection), rather than reconciling two id spaces client-side.
      expect(hook).toContain('onRunFinalized');
      expect(hook).not.toContain('onNewMessage');
    });

    it('does not wire an AG-UI connection when the API has no Harness component', async () => {
      updateJson(tree, 'apps/backend/project.json', (config) => ({
        ...config,
        metadata: { ...config.metadata, components: [] },
      }));

      await reactGenerator(tree, {
        frontendProjectName: 'frontend',
        backendProjectName: 'backend',
      });

      expect(
        tree.exists('apps/frontend/src/components/AguiProvider.tsx'),
      ).toBeFalsy();
      const packageJson = JSON.parse(
        tree.read('apps/frontend/package.json', 'utf-8'),
      );
      expect(
        packageJson.dependencies['@copilotkit/react-core'],
      ).toBeUndefined();
    });

    it('is idempotent when re-run with the same inputs', async () => {
      await reactGenerator(tree, {
        frontendProjectName: 'frontend',
        backendProjectName: 'backend',
      });

      const before = tree.read(
        'apps/frontend/src/hooks/useAguiMyHarness.tsx',
        'utf-8',
      );
      const providerBefore = tree.read(
        'apps/frontend/src/components/AguiProvider.tsx',
        'utf-8',
      );

      await reactGenerator(tree, {
        frontendProjectName: 'frontend',
        backendProjectName: 'backend',
      });

      expect(
        tree.read('apps/frontend/src/hooks/useAguiMyHarness.tsx', 'utf-8'),
      ).toEqual(before);
      const providerAfter = tree.read(
        'apps/frontend/src/components/AguiProvider.tsx',
        'utf-8',
      );
      expect(providerAfter).toEqual(providerBefore);
      // Registered exactly once, not once per re-run.
      expect(providerAfter?.split('myHarnessAgents').length).toBeGreaterThan(1);
      expect(providerAfter?.match(/useAguiMyHarness\(\)/g)?.length).toBe(1);
    });
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
    tree.write(
      'apps/frontend/package.json',
      JSON.stringify({
        name: '@my-scope/frontend',
        version: '0.0.0',
        private: true,
        type: 'module',
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
          auth: 'custom',
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

    // Generate a React website
    await tsReactWebsiteGenerator(tree, {
      name: 'frontend',
      preferInstallDependencies: false,
      iac: 'cdk',
    });
  });

  it('should configure dev integration with generated projects', async () => {
    // Generate a trpc backend
    await tsTrpcApiGenerator(tree, {
      name: 'TestApi',
      auth: 'custom',
      infra: 'http-lambda',
      iac: 'cdk',
    });

    await reactGenerator(tree, {
      frontendProjectName: 'frontend',
      backendProjectName: 'test-api',
    });

    // Read the frontend project configuration
    const frontendProject = JSON.parse(
      tree.read('frontend/project.json', 'utf-8'),
    );

    // Verify that dev target now depends on backend dev target
    expect(frontendProject.targets['dev'].dependsOn).toContainEqual({
      projects: ['@proj/test-api'],
      target: 'dev',
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
      auth: 'custom',
      infra: 'http-lambda',
      iac: 'cdk',
    });

    // Generate second API
    await tsTrpcApiGenerator(tree, {
      name: 'SecondApi',
      auth: 'custom',
      infra: 'http-lambda',
      iac: 'cdk',
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
