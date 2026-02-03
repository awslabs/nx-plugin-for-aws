/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import { addTargetToServeLocal, ServeLocalOptions } from './serve-local';

describe('serve-local', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  describe('addTargetToServeLocal', () => {
    const options: ServeLocalOptions = {
      apiName: 'testApi',
      url: 'http://localhost:3001',
    };

    it('should add target dependency when both projects have required targets', () => {
      // Setup source project with serve-local target
      tree.write(
        'apps/frontend/project.json',
        JSON.stringify({
          name: 'frontend',
          root: 'apps/frontend',
          sourceRoot: 'apps/frontend/src',
          targets: {
            'serve-local': {
              executor: '@nx/webpack:dev-server',
              options: {},
            },
          },
        }),
      );

      // Setup target project with continuous serve target
      tree.write(
        'apps/backend/project.json',
        JSON.stringify({
          name: 'backend',
          root: 'apps/backend',
          sourceRoot: 'apps/backend/src',
          targets: {
            serve: {
              executor: '@nx/node:execute',
              continuous: true,
              options: {},
            },
          },
        }),
      );

      addTargetToServeLocal(tree, 'frontend', 'backend', options);

      const updatedProject = JSON.parse(
        tree.read('apps/frontend/project.json', 'utf-8'),
      );

      expect(updatedProject.targets['serve-local'].dependsOn).toEqual([
        {
          projects: ['backend'],
          target: 'serve',
        },
      ]);
    });

    it('should append to existing dependsOn array', () => {
      // Setup source project with serve-local target that already has dependencies
      tree.write(
        'apps/frontend/project.json',
        JSON.stringify({
          name: 'frontend',
          root: 'apps/frontend',
          sourceRoot: 'apps/frontend/src',
          targets: {
            'serve-local': {
              executor: '@nx/webpack:dev-server',
              options: {},
              dependsOn: [
                {
                  projects: ['existing-project'],
                  target: 'build',
                },
              ],
            },
          },
        }),
      );

      // Setup target project with continuous serve target
      tree.write(
        'apps/backend/project.json',
        JSON.stringify({
          name: 'backend',
          root: 'apps/backend',
          sourceRoot: 'apps/backend/src',
          targets: {
            serve: {
              executor: '@nx/node:execute',
              continuous: true,
              options: {},
            },
          },
        }),
      );

      addTargetToServeLocal(tree, 'frontend', 'backend', options);

      const updatedProject = JSON.parse(
        tree.read('apps/frontend/project.json', 'utf-8'),
      );

      expect(updatedProject.targets['serve-local'].dependsOn).toEqual([
        {
          projects: ['existing-project'],
          target: 'build',
        },
        {
          projects: ['backend'],
          target: 'serve',
        },
      ]);
    });

    it('should not modify project when target project lacks continuous serve target', () => {
      // Setup source project with serve-local target
      tree.write(
        'apps/frontend/project.json',
        JSON.stringify({
          name: 'frontend',
          root: 'apps/frontend',
          sourceRoot: 'apps/frontend/src',
          targets: {
            'serve-local': {
              executor: '@nx/webpack:dev-server',
              options: {},
            },
          },
        }),
      );

      // Setup target project with non-continuous serve target
      tree.write(
        'apps/backend/project.json',
        JSON.stringify({
          name: 'backend',
          root: 'apps/backend',
          sourceRoot: 'apps/backend/src',
          targets: {
            serve: {
              executor: '@nx/node:execute',
              continuous: false,
              options: {},
            },
          },
        }),
      );

      const originalProject = tree.read('apps/frontend/project.json', 'utf-8');

      addTargetToServeLocal(tree, 'frontend', 'backend', options);

      const updatedProject = tree.read('apps/frontend/project.json', 'utf-8');
      expect(updatedProject).toBe(originalProject);
    });

    it('should not modify project when target project has no serve target', () => {
      // Setup source project with serve-local target
      tree.write(
        'apps/frontend/project.json',
        JSON.stringify({
          name: 'frontend',
          root: 'apps/frontend',
          sourceRoot: 'apps/frontend/src',
          targets: {
            'serve-local': {
              executor: '@nx/webpack:dev-server',
              options: {},
            },
          },
        }),
      );

      // Setup target project without serve target
      tree.write(
        'apps/backend/project.json',
        JSON.stringify({
          name: 'backend',
          root: 'apps/backend',
          sourceRoot: 'apps/backend/src',
          targets: {
            build: {
              executor: '@nx/node:build',
              options: {},
            },
          },
        }),
      );

      const originalProject = tree.read('apps/frontend/project.json', 'utf-8');

      addTargetToServeLocal(tree, 'frontend', 'backend', options);

      const updatedProject = tree.read('apps/frontend/project.json', 'utf-8');
      expect(updatedProject).toBe(originalProject);
    });

    it('should not modify project when source project has no serve-local target', () => {
      // Setup source project without serve-local target
      tree.write(
        'apps/frontend/project.json',
        JSON.stringify({
          name: 'frontend',
          root: 'apps/frontend',
          sourceRoot: 'apps/frontend/src',
          targets: {
            serve: {
              executor: '@nx/webpack:dev-server',
              options: {},
            },
          },
        }),
      );

      // Setup target project with continuous serve target
      tree.write(
        'apps/backend/project.json',
        JSON.stringify({
          name: 'backend',
          root: 'apps/backend',
          sourceRoot: 'apps/backend/src',
          targets: {
            serve: {
              executor: '@nx/node:execute',
              continuous: true,
              options: {},
            },
          },
        }),
      );

      const originalProject = tree.read('apps/frontend/project.json', 'utf-8');

      addTargetToServeLocal(tree, 'frontend', 'backend', options);

      const updatedProject = tree.read('apps/frontend/project.json', 'utf-8');
      expect(updatedProject).toBe(originalProject);
    });

    it('should modify runtime config when file exists', () => {
      // Setup source project with serve-local target
      tree.write(
        'apps/frontend/project.json',
        JSON.stringify({
          name: 'frontend',
          root: 'apps/frontend',
          sourceRoot: 'apps/frontend/src',
          targets: {
            'serve-local': {
              executor: '@nx/webpack:dev-server',
              options: {},
            },
          },
        }),
      );

      // Setup target project with continuous serve target
      tree.write(
        'apps/backend/project.json',
        JSON.stringify({
          name: 'backend',
          root: 'apps/backend',
          sourceRoot: 'apps/backend/src',
          targets: {
            serve: {
              executor: '@nx/node:execute',
              continuous: true,
              options: {},
            },
          },
        }),
      );

      // Setup runtime config file
      tree.write(
        'apps/frontend/src/components/RuntimeConfig/index.tsx',
        `
const applyOverrides = (runtimeConfig: IRuntimeConfig) => {
  if (import.meta.env.MODE === 'serve-local') {
    // Local development overrides will be added here
  }
  return runtimeConfig;
};
`,
      );

      addTargetToServeLocal(tree, 'frontend', 'backend', options);

      const updatedRuntimeConfig = tree.read(
        'apps/frontend/src/components/RuntimeConfig/index.tsx',
        'utf-8',
      );

      // Verify that the runtime config was modified to include the API override
      expect(updatedRuntimeConfig).toContain(
        "runtimeConfig.apis.TestApi = 'http://localhost:3001'",
      );
    });

    it('should not modify runtime config when file does not exist', () => {
      // Setup source project with serve-local target
      tree.write(
        'apps/frontend/project.json',
        JSON.stringify({
          name: 'frontend',
          root: 'apps/frontend',
          sourceRoot: 'apps/frontend/src',
          targets: {
            'serve-local': {
              executor: '@nx/webpack:dev-server',
              options: {},
            },
          },
        }),
      );

      // Setup target project with continuous serve target
      tree.write(
        'apps/backend/project.json',
        JSON.stringify({
          name: 'backend',
          root: 'apps/backend',
          sourceRoot: 'apps/backend/src',
          targets: {
            serve: {
              executor: '@nx/node:execute',
              continuous: true,
              options: {},
            },
          },
        }),
      );

      // Don't create runtime config file
      expect(() => {
        addTargetToServeLocal(tree, 'frontend', 'backend', options);
      }).not.toThrow();

      // Verify runtime config file was not created
      expect(
        tree.exists('apps/frontend/src/components/RuntimeConfig/index.tsx'),
      ).toBe(false);
    });

    it('should handle missing targets object gracefully', () => {
      // Setup source project without targets
      tree.write(
        'apps/frontend/project.json',
        JSON.stringify({
          name: 'frontend',
          root: 'apps/frontend',
          sourceRoot: 'apps/frontend/src',
        }),
      );

      // Setup target project with continuous serve target
      tree.write(
        'apps/backend/project.json',
        JSON.stringify({
          name: 'backend',
          root: 'apps/backend',
          sourceRoot: 'apps/backend/src',
          targets: {
            serve: {
              executor: '@nx/node:execute',
              continuous: true,
              options: {},
            },
          },
        }),
      );

      const originalProject = tree.read('apps/frontend/project.json', 'utf-8');

      addTargetToServeLocal(tree, 'frontend', 'backend', options);

      const updatedProject = tree.read('apps/frontend/project.json', 'utf-8');
      expect(updatedProject).toBe(originalProject);
    });

    it('should handle target project with missing targets object', () => {
      // Setup source project with serve-local target
      tree.write(
        'apps/frontend/project.json',
        JSON.stringify({
          name: 'frontend',
          root: 'apps/frontend',
          sourceRoot: 'apps/frontend/src',
          targets: {
            'serve-local': {
              executor: '@nx/webpack:dev-server',
              options: {},
            },
          },
        }),
      );

      // Setup target project without targets
      tree.write(
        'apps/backend/project.json',
        JSON.stringify({
          name: 'backend',
          root: 'apps/backend',
          sourceRoot: 'apps/backend/src',
        }),
      );

      const originalProject = tree.read('apps/frontend/project.json', 'utf-8');

      addTargetToServeLocal(tree, 'frontend', 'backend', options);

      const updatedProject = tree.read('apps/frontend/project.json', 'utf-8');
      expect(updatedProject).toBe(originalProject);
    });
  });
});
