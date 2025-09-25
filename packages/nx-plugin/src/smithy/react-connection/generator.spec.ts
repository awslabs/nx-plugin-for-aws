/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree, updateJson } from '@nx/devkit';
import { vi, expect, describe, it, beforeEach } from 'vitest';
import {
  smithyReactConnectionGenerator,
  SMITHY_REACT_CONNECTION_GENERATOR_INFO,
} from './generator';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { query } from '../../utils/ast';
import { SMITHY_PROJECT_GENERATOR_INFO } from '../project/generator';
import { TS_SMITHY_API_GENERATOR_INFO } from '../ts/api/generator';
import { tsReactWebsiteGenerator } from '../../ts/react-website/app/generator';
import { tsSmithyApiGenerator } from '../ts/api/generator';

describe('smithy#react-connection generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  describe('with model project as target', () => {
    beforeEach(() => {
      // Setup a React project
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
      tree.write(
        'apps/frontend/project.json',
        JSON.stringify({
          name: 'frontend',
          root: 'apps/frontend',
          sourceRoot: 'apps/frontend/src',
          targets: {
            compile: {},
            bundle: {},
          },
        }),
      );

      // Setup a Smithy model project
      tree.write(
        'apps/api-model/project.json',
        JSON.stringify({
          name: 'api-model',
          root: 'apps/api-model',
          sourceRoot: 'apps/api-model/src',
          metadata: {
            generator: SMITHY_PROJECT_GENERATOR_INFO.id,
            apiName: 'TestApi',
            backendProject: 'api-backend',
          },
        }),
      );

      // Setup smithy-build.json for the model project
      tree.write(
        'apps/api-model/smithy-build.json',
        JSON.stringify({
          version: '1.0',
          sources: ['src/'],
          plugins: {
            openapi: {
              service: 'com.example.testapi#TestApiService',
              version: '3.1.0',
              tags: true,
              useIntegerType: true,
            },
          },
        }),
      );

      // Setup the associated backend project
      tree.write(
        'apps/api-backend/project.json',
        JSON.stringify({
          name: 'api-backend',
          root: 'apps/api-backend',
          metadata: {
            generator: TS_SMITHY_API_GENERATOR_INFO.id,
            apiName: 'TestApi',
            auth: 'IAM',
            port: 3001,
          },
        }),
      );
    });

    it('should update frontend project configuration with client generation targets', async () => {
      await smithyReactConnectionGenerator(tree, {
        frontendProjectName: 'frontend',
        smithyModelOrBackendProjectName: 'api-model',
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
        'nx g @aws/nx-plugin:open-api#ts-hooks --openApiSpecPath="dist/apps/api-model/build/openapi/openapi.json" --outputPath="apps/frontend/src/generated/test-api" --no-interactive',
      ]);
      expect(
        projectConfig.targets['generate:test-api-client'].dependsOn,
      ).toContain('api-model:build');

      // Verify watch generate target was added
      expect(
        projectConfig.targets['watch-generate:test-api-client'],
      ).toBeDefined();
      expect(
        projectConfig.targets['watch-generate:test-api-client'].executor,
      ).toBe('nx:run-commands');
      expect(
        projectConfig.targets['watch-generate:test-api-client'].continuous,
      ).toBe(true);
      expect(
        projectConfig.targets['watch-generate:test-api-client'].options
          .commands,
      ).toEqual([
        `nx watch --projects=api-model --includeDependentProjects -- nx run frontend:"generate:test-api-client"`,
      ]);

      // Verify compile target depends on client generation
      expect(projectConfig.targets.compile.dependsOn).toContain(
        'generate:test-api-client',
      );

      // Verify bundle target depends on client generation
      expect(projectConfig.targets.bundle.dependsOn).toContain(
        'generate:test-api-client',
      );
    });

    it('should generate client hook files', async () => {
      await smithyReactConnectionGenerator(tree, {
        frontendProjectName: 'frontend',
        smithyModelOrBackendProjectName: 'api-model',
      });

      // Verify vanilla client hook was created
      expect(
        tree.exists('apps/frontend/src/hooks/useTestApiClient.tsx'),
      ).toBeTruthy();

      // Verify tanstack query hook was created
      expect(
        tree.exists('apps/frontend/src/hooks/useTestApi.tsx'),
      ).toBeTruthy();

      // Create snapshots of generated hooks
      expect(
        tree.read('apps/frontend/src/hooks/useTestApiClient.tsx', 'utf-8'),
      ).toMatchSnapshot('useTestApiClient.tsx');

      expect(
        tree.read('apps/frontend/src/hooks/useTestApi.tsx', 'utf-8'),
      ).toMatchSnapshot('useTestApi.tsx');
    });

    it('should generate provider components', async () => {
      await smithyReactConnectionGenerator(tree, {
        frontendProjectName: 'frontend',
        smithyModelOrBackendProjectName: 'api-model',
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
      await smithyReactConnectionGenerator(tree, {
        frontendProjectName: 'frontend',
        smithyModelOrBackendProjectName: 'api-model',
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
      await smithyReactConnectionGenerator(tree, {
        frontendProjectName: 'frontend',
        smithyModelOrBackendProjectName: 'api-model',
      });

      await smithyReactConnectionGenerator(tree, {
        frontendProjectName: 'frontend',
        smithyModelOrBackendProjectName: 'api-model',
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

    it('should add generated client to .gitignore', async () => {
      await smithyReactConnectionGenerator(tree, {
        frontendProjectName: 'frontend',
        smithyModelOrBackendProjectName: 'api-model',
      });

      // Verify generated client is ignored by default
      expect(tree.exists('apps/frontend/.gitignore')).toBeTruthy();
      expect(tree.read('apps/frontend/.gitignore', 'utf-8')).toContain(
        'src/generated/test-api',
      );
    });

    it('should add extensions.smithy file to model project src directory', async () => {
      await smithyReactConnectionGenerator(tree, {
        frontendProjectName: 'frontend',
        smithyModelOrBackendProjectName: 'api-model',
      });

      // Verify that extensions.smithy was added to the model project's src directory
      expect(tree.exists('apps/api-model/src/extensions.smithy')).toBeTruthy();

      // Verify the content contains the expected Smithy traits
      const extensionsContent = tree.read(
        'apps/api-model/src/extensions.smithy',
        'utf-8',
      );
      expect(extensionsContent).toContain('@trait');
      expect(extensionsContent).toContain('structure query {}');
      expect(extensionsContent).toContain('structure mutation {}');
      expect(extensionsContent).toContain('structure cursor {');
    });

    it('should use correct namespace in extensions.smithy file', async () => {
      await smithyReactConnectionGenerator(tree, {
        frontendProjectName: 'frontend',
        smithyModelOrBackendProjectName: 'api-model',
      });

      // Verify that extensions.smithy contains the correct namespace
      const extensionsContent = tree.read(
        'apps/api-model/src/extensions.smithy',
        'utf-8',
      );
      expect(extensionsContent).toContain('namespace com.example.testapi');
    });

    it('should add runtime config for local development', async () => {
      await smithyReactConnectionGenerator(tree, {
        frontendProjectName: 'frontend',
        smithyModelOrBackendProjectName: 'api-model',
      });

      // Verify that the runtime config was created
      expect(
        tree.exists('apps/frontend/src/components/RuntimeConfig/index.tsx'),
      ).toBeTruthy();
    });

    it('should handle IAM auth option', async () => {
      await smithyReactConnectionGenerator(tree, {
        frontendProjectName: 'frontend',
        smithyModelOrBackendProjectName: 'api-model',
      });

      // Verify sigv4 hook was added for IAM auth
      expect(tree.exists('apps/frontend/src/hooks/useSigV4.tsx')).toBeTruthy();

      // Verify IAM-specific dependencies were added
      const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));
      expect(packageJson.dependencies['oidc-client-ts']).toBeDefined();
      expect(packageJson.dependencies['react-oidc-context']).toBeDefined();
      expect(
        packageJson.dependencies['@aws-sdk/client-cognito-identity'],
      ).toBeDefined();
      expect(
        packageJson.dependencies[
          '@aws-sdk/credential-provider-cognito-identity'
        ],
      ).toBeDefined();
      expect(packageJson.dependencies['aws4fetch']).toBeDefined();

      // Create snapshot of generated provider with IAM auth
      expect(
        tree.read('apps/frontend/src/components/TestApiProvider.tsx', 'utf-8'),
      ).toMatchSnapshot('TestApiProvider-IAM.tsx');
    });

    it('should handle Cognito auth option', async () => {
      // Update backend project to use Cognito auth
      updateJson(tree, 'apps/api-backend/project.json', (config) => ({
        ...config,
        metadata: {
          ...config.metadata,
          auth: 'Cognito',
        },
      }));

      await smithyReactConnectionGenerator(tree, {
        frontendProjectName: 'frontend',
        smithyModelOrBackendProjectName: 'api-model',
      });

      // Verify sigv4 hook was NOT added for Cognito auth
      expect(tree.exists('apps/frontend/src/hooks/useSigV4.tsx')).toBeFalsy();

      // Verify Cognito-specific dependencies were added
      const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));
      expect(packageJson.dependencies['react-oidc-context']).toBeDefined();

      // Create snapshot of generated provider with Cognito auth
      expect(
        tree.read('apps/frontend/src/components/TestApiProvider.tsx', 'utf-8'),
      ).toMatchSnapshot('TestApiProvider-Cognito.tsx');
    });

    it('should handle None auth option', async () => {
      // Update backend project to use None auth
      updateJson(tree, 'apps/api-backend/project.json', (config) => ({
        ...config,
        metadata: {
          ...config.metadata,
          auth: 'None',
        },
      }));

      await smithyReactConnectionGenerator(tree, {
        frontendProjectName: 'frontend',
        smithyModelOrBackendProjectName: 'api-model',
      });

      // Verify sigv4 hook was NOT added for None auth
      expect(tree.exists('apps/frontend/src/hooks/useSigV4.tsx')).toBeFalsy();

      // Create snapshot of generated provider with None auth
      expect(
        tree.read('apps/frontend/src/components/TestApiProvider.tsx', 'utf-8'),
      ).toMatchSnapshot('TestApiProvider-None.tsx');
    });

    it('should use default values for auth and port when not specified', async () => {
      // Update backend project to remove auth and port
      updateJson(tree, 'apps/api-backend/project.json', (config) => ({
        ...config,
        metadata: {
          generator: config.metadata.generator,
          apiName: config.metadata.apiName,
        },
      }));

      await smithyReactConnectionGenerator(tree, {
        frontendProjectName: 'frontend',
        smithyModelOrBackendProjectName: 'api-model',
      });

      // Should default to IAM auth, so sigv4 hook should be added
      expect(tree.exists('apps/frontend/src/hooks/useSigV4.tsx')).toBeTruthy();

      // Verify that the runtime config was created
      expect(
        tree.exists('apps/frontend/src/components/RuntimeConfig/index.tsx'),
      ).toBeTruthy();
    });

    it('should use ports array fallback when port is not specified', async () => {
      // Update backend project to use ports array instead of port
      updateJson(tree, 'apps/api-backend/project.json', (config) => ({
        ...config,
        metadata: {
          ...config.metadata,
          ports: [4000, 4001],
        },
      }));

      await smithyReactConnectionGenerator(tree, {
        frontendProjectName: 'frontend',
        smithyModelOrBackendProjectName: 'api-model',
      });

      // Verify that the runtime config was created
      expect(
        tree.exists('apps/frontend/src/components/RuntimeConfig/index.tsx'),
      ).toBeTruthy();
    });
  });

  describe('with backend project as target', () => {
    beforeEach(() => {
      // Setup a React project
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
      tree.write(
        'apps/frontend/project.json',
        JSON.stringify({
          name: 'frontend',
          root: 'apps/frontend',
          sourceRoot: 'apps/frontend/src',
          targets: {
            compile: {},
            bundle: {},
          },
        }),
      );

      // Setup a Smithy backend project
      tree.write(
        'apps/api-backend/project.json',
        JSON.stringify({
          name: 'api-backend',
          root: 'apps/api-backend',
          metadata: {
            generator: TS_SMITHY_API_GENERATOR_INFO.id,
            apiName: 'TestApi',
            auth: 'Cognito',
            port: 4000,
            modelProject: 'api-model',
          },
        }),
      );

      // Setup the associated model project
      tree.write(
        'apps/api-model/project.json',
        JSON.stringify({
          name: 'api-model',
          root: 'apps/api-model',
          sourceRoot: 'apps/api-model/src',
          metadata: {
            generator: SMITHY_PROJECT_GENERATOR_INFO.id,
            apiName: 'TestApi',
          },
        }),
      );

      // Setup smithy-build.json for the model project
      tree.write(
        'apps/api-model/smithy-build.json',
        JSON.stringify({
          version: '1.0',
          sources: ['src/'],
          plugins: {
            openapi: {
              service: 'com.example.testapi#TestApiService',
              version: '3.1.0',
              tags: true,
              useIntegerType: true,
            },
          },
        }),
      );
    });

    it('should work when target is backend project', async () => {
      await smithyReactConnectionGenerator(tree, {
        frontendProjectName: 'frontend',
        smithyModelOrBackendProjectName: 'api-backend',
      });

      const projectConfig = JSON.parse(
        tree.read('apps/frontend/project.json', 'utf-8'),
      );

      // Verify client generation target uses model project for spec build
      expect(
        projectConfig.targets['generate:test-api-client'].dependsOn,
      ).toContain('api-model:build');

      // Verify the correct spec path is used (from model project)
      expect(
        projectConfig.targets['generate:test-api-client'].options.commands,
      ).toEqual([
        'nx g @aws/nx-plugin:open-api#ts-hooks --openApiSpecPath="dist/apps/api-model/build/openapi/openapi.json" --outputPath="apps/frontend/src/generated/test-api" --no-interactive',
      ]);

      // Verify Cognito auth is used
      expect(tree.exists('apps/frontend/src/hooks/useSigV4.tsx')).toBeFalsy();

      // Verify that the runtime config was created
      expect(
        tree.exists('apps/frontend/src/components/RuntimeConfig/index.tsx'),
      ).toBeTruthy();
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      // Setup a React project
      tree.write('apps/frontend/src/main.tsx', '');
      tree.write(
        'apps/frontend/project.json',
        JSON.stringify({
          name: 'frontend',
          root: 'apps/frontend',
          sourceRoot: 'apps/frontend/src',
        }),
      );
    });

    it('should throw error when backend project is not found for model project', async () => {
      // Setup a Smithy model project without backendProject metadata
      tree.write(
        'apps/api-model/project.json',
        JSON.stringify({
          name: 'api-model',
          root: 'apps/api-model',
          sourceRoot: 'apps/api-model/src',
          metadata: {
            generator: SMITHY_PROJECT_GENERATOR_INFO.id,
            apiName: 'TestApi',
          },
        }),
      );

      await expect(
        smithyReactConnectionGenerator(tree, {
          frontendProjectName: 'frontend',
          smithyModelOrBackendProjectName: 'api-model',
        }),
      ).rejects.toThrow(
        'Could not find associated backend for Smithy model project api-model',
      );
    });

    it('should throw error when smithy-build.json is missing', async () => {
      // Setup a Smithy model project without smithy-build.json
      tree.write(
        'apps/api-model/project.json',
        JSON.stringify({
          name: 'api-model',
          root: 'apps/api-model',
          sourceRoot: 'apps/api-model/src',
          metadata: {
            generator: SMITHY_PROJECT_GENERATOR_INFO.id,
            apiName: 'TestApi',
            backendProject: 'api-backend',
          },
        }),
      );

      // Setup the associated backend project
      tree.write(
        'apps/api-backend/project.json',
        JSON.stringify({
          name: 'api-backend',
          root: 'apps/api-backend',
          metadata: {
            generator: TS_SMITHY_API_GENERATOR_INFO.id,
            apiName: 'TestApi',
          },
        }),
      );

      await expect(
        smithyReactConnectionGenerator(tree, {
          frontendProjectName: 'frontend',
          smithyModelOrBackendProjectName: 'api-model',
        }),
      ).rejects.toThrow(
        'No smithy-build.json file found for model project api-model',
      );
    });

    it('should throw error when smithy-build.json has invalid format', async () => {
      // Setup a Smithy model project with invalid smithy-build.json
      tree.write(
        'apps/api-model/project.json',
        JSON.stringify({
          name: 'api-model',
          root: 'apps/api-model',
          sourceRoot: 'apps/api-model/src',
          metadata: {
            generator: SMITHY_PROJECT_GENERATOR_INFO.id,
            apiName: 'TestApi',
            backendProject: 'api-backend',
          },
        }),
      );

      // Setup smithy-build.json with missing plugins.openapi.service
      tree.write(
        'apps/api-model/smithy-build.json',
        JSON.stringify({
          version: '1.0',
          sources: ['src/'],
          plugins: {
            openapi: {
              version: '3.1.0',
              tags: true,
              useIntegerType: true,
            },
          },
        }),
      );

      // Setup the associated backend project
      tree.write(
        'apps/api-backend/project.json',
        JSON.stringify({
          name: 'api-backend',
          root: 'apps/api-backend',
          metadata: {
            generator: TS_SMITHY_API_GENERATOR_INFO.id,
            apiName: 'TestApi',
          },
        }),
      );

      await expect(
        smithyReactConnectionGenerator(tree, {
          frontendProjectName: 'frontend',
          smithyModelOrBackendProjectName: 'api-model',
        }),
      ).rejects.toThrow(
        'Unable to determine namespace from apps/api-model/smithy-build.json. Expected plugins.openapi.service to be defined.',
      );
    });

    it('should throw error when smithy-build.json is malformed JSON', async () => {
      // Setup a Smithy model project with malformed smithy-build.json
      tree.write(
        'apps/api-model/project.json',
        JSON.stringify({
          name: 'api-model',
          root: 'apps/api-model',
          sourceRoot: 'apps/api-model/src',
          metadata: {
            generator: SMITHY_PROJECT_GENERATOR_INFO.id,
            apiName: 'TestApi',
            backendProject: 'api-backend',
          },
        }),
      );

      // Setup malformed smithy-build.json
      tree.write('apps/api-model/smithy-build.json', '{ invalid json }');

      // Setup the associated backend project
      tree.write(
        'apps/api-backend/project.json',
        JSON.stringify({
          name: 'api-backend',
          root: 'apps/api-backend',
          metadata: {
            generator: TS_SMITHY_API_GENERATOR_INFO.id,
            apiName: 'TestApi',
          },
        }),
      );

      await expect(
        smithyReactConnectionGenerator(tree, {
          frontendProjectName: 'frontend',
          smithyModelOrBackendProjectName: 'api-model',
        }),
      ).rejects.toThrow(
        'Unable to determine namespace from apps/api-model/smithy-build.json. Expected plugins.openapi.service to be defined.',
      );
    });

    it('should throw error when model project is not found for backend project', async () => {
      // Setup a Smithy backend project without modelProject metadata
      tree.write(
        'apps/api-backend/project.json',
        JSON.stringify({
          name: 'api-backend',
          root: 'apps/api-backend',
          metadata: {
            generator: TS_SMITHY_API_GENERATOR_INFO.id,
            apiName: 'TestApi',
          },
        }),
      );

      await expect(
        smithyReactConnectionGenerator(tree, {
          frontendProjectName: 'frontend',
          smithyModelOrBackendProjectName: 'api-backend',
        }),
      ).rejects.toThrow(
        'Could not find associated model for Smithy backend project api-backend',
      );
    });

    it('should throw error for unsupported project type', async () => {
      // Setup an unsupported project type
      tree.write(
        'apps/unknown/project.json',
        JSON.stringify({
          name: 'unknown',
          root: 'apps/unknown',
          metadata: {
            generator: 'some-other-generator',
          },
        }),
      );

      await expect(
        smithyReactConnectionGenerator(tree, {
          frontendProjectName: 'frontend',
          smithyModelOrBackendProjectName: 'unknown',
        }),
      ).rejects.toThrow(
        'Unsupported api-connection target unknown. Expected a Smithy model or backend project.',
      );
    });

    it('should throw error for project without generator metadata', async () => {
      // Setup a project without generator metadata
      tree.write(
        'apps/unknown/project.json',
        JSON.stringify({
          name: 'unknown',
          root: 'apps/unknown',
        }),
      );

      await expect(
        smithyReactConnectionGenerator(tree, {
          frontendProjectName: 'frontend',
          smithyModelOrBackendProjectName: 'unknown',
        }),
      ).rejects.toThrow(
        'Unsupported api-connection target unknown. Expected a Smithy model or backend project.',
      );
    });
  });

  describe('project name resolution', () => {
    beforeEach(() => {
      // Setup package.json with a scope
      tree.write(
        'package.json',
        JSON.stringify({
          name: '@my-scope/monorepo',
          version: '1.0.0',
        }),
      );

      // Setup a React project with qualified name
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
      tree.write(
        'apps/frontend/project.json',
        JSON.stringify({
          name: '@my-scope/frontend',
          root: 'apps/frontend',
          sourceRoot: 'apps/frontend/src',
          targets: {
            compile: {},
            bundle: {},
          },
        }),
      );
    });

    it('should handle qualified project names', async () => {
      // Setup a Smithy model project with qualified names
      tree.write(
        'apps/api-model/project.json',
        JSON.stringify({
          name: '@my-scope/api-model',
          root: 'apps/api-model',
          sourceRoot: 'apps/api-model/src',
          metadata: {
            generator: SMITHY_PROJECT_GENERATOR_INFO.id,
            apiName: 'TestApi',
            backendProject: '@my-scope/api-backend',
          },
        }),
      );

      // Setup smithy-build.json for the model project
      tree.write(
        'apps/api-model/smithy-build.json',
        JSON.stringify({
          version: '1.0',
          sources: ['src/'],
          plugins: {
            openapi: {
              service: 'com.example.testapi#TestApiService',
              version: '3.1.0',
              tags: true,
              useIntegerType: true,
            },
          },
        }),
      );

      // Setup the associated backend project
      tree.write(
        'apps/api-backend/project.json',
        JSON.stringify({
          name: '@my-scope/api-backend',
          root: 'apps/api-backend',
          metadata: {
            generator: TS_SMITHY_API_GENERATOR_INFO.id,
            apiName: 'TestApi',
          },
        }),
      );

      await smithyReactConnectionGenerator(tree, {
        frontendProjectName: 'frontend', // unqualified
        smithyModelOrBackendProjectName: 'api-model', // unqualified
      });

      const projectConfig = JSON.parse(
        tree.read('apps/frontend/project.json', 'utf-8'),
      );

      // Verify that qualified names are used in dependencies
      expect(
        projectConfig.targets['generate:test-api-client'].dependsOn,
      ).toContain('@my-scope/api-model:build');
    });
  });

  describe('metrics', () => {
    it('should add generator metric to app.ts', async () => {
      await sharedConstructsGenerator(tree, { iacProvider: 'CDK' });

      // Setup a React project with proper main.tsx structure
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
      tree.write(
        'apps/frontend/project.json',
        JSON.stringify({
          name: 'frontend',
          root: 'apps/frontend',
          sourceRoot: 'apps/frontend/src',
        }),
      );

      // Setup a Smithy model project
      tree.write(
        'apps/api-model/project.json',
        JSON.stringify({
          name: 'api-model',
          root: 'apps/api-model',
          sourceRoot: 'apps/api-model/src',
          metadata: {
            generator: SMITHY_PROJECT_GENERATOR_INFO.id,
            apiName: 'TestApi',
            backendProject: 'api-backend',
          },
        }),
      );

      // Setup smithy-build.json for the model project
      tree.write(
        'apps/api-model/smithy-build.json',
        JSON.stringify({
          version: '1.0',
          sources: ['src/'],
          plugins: {
            openapi: {
              service: 'com.example.testapi#TestApiService',
              version: '3.1.0',
              tags: true,
              useIntegerType: true,
            },
          },
        }),
      );

      // Setup the associated backend project
      tree.write(
        'apps/api-backend/project.json',
        JSON.stringify({
          name: 'api-backend',
          root: 'apps/api-backend',
          metadata: {
            generator: TS_SMITHY_API_GENERATOR_INFO.id,
            apiName: 'TestApi',
          },
        }),
      );

      await smithyReactConnectionGenerator(tree, {
        frontendProjectName: 'frontend',
        smithyModelOrBackendProjectName: 'api-model',
      });

      expectHasMetricTags(tree, SMITHY_REACT_CONNECTION_GENERATOR_INFO.metric);
    });
  });

  describe('smithy#react-connection generator with real projects', () => {
    let tree: Tree;

    beforeEach(async () => {
      tree = createTreeUsingTsSolutionSetup();

      // Generate a react website
      await tsReactWebsiteGenerator(tree, {
        name: 'frontend',
        skipInstall: true,
        iacProvider: 'CDK',
      });
    });

    it('should configure serve-local integration with generated projects end-to-end', async () => {
      // Generate a smithy API using the real generator (creates both model and backend projects)
      await tsSmithyApiGenerator(tree, {
        name: 'TestApi',
        auth: 'None',
        computeType: 'ServerlessApiGatewayRestApi',
        iacProvider: 'CDK',
      });

      // Connect the frontend to the smithy API using the model project name
      await smithyReactConnectionGenerator(tree, {
        frontendProjectName: 'frontend',
        smithyModelOrBackendProjectName: '@proj/test-api-model', // model project name
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
      // Should also depend on the generate target (for initial generation)
      expect(frontendProject.targets['serve-local'].dependsOn).toContain(
        'generate:test-api-client',
      );
      // Should also depend on the generate watch target (for ongoing changes)
      expect(frontendProject.targets['serve-local'].dependsOn).toContain(
        'watch-generate:test-api-client',
      );

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
      expect(runtimeConfigContent).toContain('http://localhost:3001/');

      // Verify that the client generation target was properly configured
      expect(frontendProject.targets['generate:test-api-client']).toBeDefined();
      expect(
        frontendProject.targets['generate:test-api-client'].dependsOn,
      ).toContain('@proj/test-api-model:build'); // depends on model project build

      // Verify that the generated files exist
      expect(
        tree.exists('frontend/src/hooks/useTestApiClient.tsx'),
      ).toBeTruthy();
      expect(tree.exists('frontend/src/hooks/useTestApi.tsx')).toBeTruthy();
      expect(
        tree.exists('frontend/src/components/TestApiProvider.tsx'),
      ).toBeTruthy();

      // Verify that providers were added to main.tsx
      expect(
        query(
          tree,
          'frontend/src/main.tsx',
          'JsxOpeningElement[tagName.name="QueryClientProvider"]',
        ),
      ).toHaveLength(1);

      expect(
        query(
          tree,
          'frontend/src/main.tsx',
          'JsxOpeningElement[tagName.name="TestApiProvider"]',
        ),
      ).toHaveLength(1);

      // Verify that the model project exists
      expect(tree.exists('test-api/model/project.json')).toBeTruthy();
      const modelProject = JSON.parse(
        tree.read('test-api/model/project.json', 'utf-8'),
      );
      expect(modelProject.metadata.generator).toBe(
        SMITHY_PROJECT_GENERATOR_INFO.id,
      );

      // Verify that the backend project exists
      expect(tree.exists('test-api/backend/project.json')).toBeTruthy();
      const backendProject = JSON.parse(
        tree.read('test-api/backend/project.json', 'utf-8'),
      );
      expect(backendProject.metadata.generator).toBe(
        TS_SMITHY_API_GENERATOR_INFO.id,
      );
      expect(backendProject.metadata.modelProject).toBe('@proj/test-api-model');
    });

    it('should work with different auth types in end-to-end scenario', async () => {
      // Generate a smithy API with IAM auth
      await tsSmithyApiGenerator(tree, {
        name: 'SecureApi',
        auth: 'IAM',
        computeType: 'ServerlessApiGatewayRestApi',
        iacProvider: 'CDK',
      });

      // Connect the frontend to the smithy API using the model project name
      await smithyReactConnectionGenerator(tree, {
        frontendProjectName: 'frontend',
        smithyModelOrBackendProjectName: '@proj/secure-api-model',
      });

      // Verify IAM-specific files were generated
      expect(tree.exists('frontend/src/hooks/useSigV4.tsx')).toBeTruthy();

      // Verify IAM-specific dependencies were added
      const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));
      expect(packageJson.dependencies['aws4fetch']).toBeDefined();
      expect(
        packageJson.dependencies['@aws-sdk/client-cognito-identity'],
      ).toBeDefined();

      // Verify that the runtime config includes the correct API
      const runtimeConfigContent = tree.read(
        'frontend/src/components/RuntimeConfig/index.tsx',
        'utf-8',
      );
      expect(runtimeConfigContent).toContain('runtimeConfig.apis.SecureApi');
    });
  });
});
