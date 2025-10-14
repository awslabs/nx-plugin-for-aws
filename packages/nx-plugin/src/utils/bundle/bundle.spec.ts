/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Tree,
  ProjectConfiguration,
  readJson,
  addProjectConfiguration,
} from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../test';
import { addTypeScriptBundleTarget, addPythonBundleTarget } from './bundle';

describe('bundle utilities', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  describe('addTypeScriptBundleTarget', () => {
    let project: ProjectConfiguration;

    beforeEach(() => {
      project = {
        name: 'test-project',
        root: 'apps/test-project',
        sourceRoot: 'apps/test-project/src',
        targets: {},
      };
      addProjectConfiguration(tree, project.name, project);
    });

    it('should add bundle target to project configuration', () => {
      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/index.ts',
      });

      expect(project.targets?.bundle).toBeDefined();
      expect(project.targets?.bundle?.cache).toBe(true);
      expect(project.targets?.bundle?.executor).toBe('nx:run-commands');
      expect(project.targets?.bundle?.outputs).toEqual([
        '{workspaceRoot}/dist/{projectRoot}/bundle',
      ]);
      expect(project.targets?.bundle?.options?.command).toBe(
        'rolldown -c rolldown.config.ts',
      );
      expect(project.targets?.bundle?.options?.cwd).toBe('{projectRoot}');
    });

    it('should not overwrite existing bundle target', () => {
      const existingBundleTarget = {
        cache: false,
        executor: 'custom:executor',
        options: { customOption: 'value' },
      };
      project.targets = { bundle: existingBundleTarget };

      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/index.ts',
      });

      expect(project.targets.bundle).toEqual(existingBundleTarget);
    });

    it('should generate rolldown config file', () => {
      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/index.ts',
      });

      expect(tree.exists('apps/test-project/rolldown.config.ts')).toBeTruthy();
    });

    it('should not overwrite existing rolldown config file', () => {
      const existingConfig = `
import { defineConfig } from 'rolldown';

export default defineConfig([
  {
    input: 'existing/file.ts',
    output: {
      file: 'existing/output.js',
      format: 'cjs',
    },
  },
]);
`;
      tree.write('apps/test-project/rolldown.config.ts', existingConfig);

      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/index.ts',
      });

      const configContent = tree.read(
        'apps/test-project/rolldown.config.ts',
        'utf-8',
      );
      expect(configContent).toContain('existing/file.ts');
      expect(configContent).toContain('src/index.ts');
    });

    it('should add build target dependency on bundle', () => {
      project.targets = {
        build: {
          executor: 'nx:run-commands',
          dependsOn: ['compile'],
        },
      };

      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/index.ts',
      });

      expect(project.targets.build.dependsOn).toContain('bundle');
      expect(project.targets.build.dependsOn).toContain('compile');
    });

    it('should not duplicate bundle dependency in build target', () => {
      project.targets = {
        build: {
          executor: 'nx:run-commands',
          dependsOn: ['compile', 'bundle'],
        },
      };

      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/index.ts',
      });

      const bundleDependencies = project.targets.build.dependsOn?.filter(
        (dep) => dep === 'bundle',
      );
      expect(bundleDependencies).toHaveLength(1);
    });

    it('should handle project without existing targets', () => {
      const projectWithoutTargets: ProjectConfiguration = {
        name: 'test-project',
        root: 'apps/test-project',
        sourceRoot: 'apps/test-project/src',
      };

      addTypeScriptBundleTarget(tree, projectWithoutTargets, {
        targetFilePath: 'src/index.ts',
      });

      expect(projectWithoutTargets.targets).toBeDefined();
      expect(projectWithoutTargets.targets?.bundle).toBeDefined();
    });

    it('should configure output path with bundleOutputDir', () => {
      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/index.ts',
        bundleOutputDir: 'lambda',
      });

      const configContent = tree.read(
        'apps/test-project/rolldown.config.ts',
        'utf-8',
      );
      expect(configContent).toContain(
        'dist/apps/test-project/bundle/lambda/index.js',
      );
    });

    it('should configure output path without bundleOutputDir', () => {
      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/index.ts',
      });

      const configContent = tree.read(
        'apps/test-project/rolldown.config.ts',
        'utf-8',
      );
      expect(configContent).toContain('dist/apps/test-project/bundle/index.js');
    });

    it('should add rolldown dependency to package.json', () => {
      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/index.ts',
      });

      const packageJson = readJson(tree, 'package.json');
      expect(packageJson.devDependencies).toHaveProperty('rolldown');
    });

    it('should not add duplicate config entry for same targetFilePath', () => {
      // First call
      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/index.ts',
      });

      // Second call with same targetFilePath
      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/index.ts',
      });

      const configContent = tree.read(
        'apps/test-project/rolldown.config.ts',
        'utf-8',
      );

      // Count occurrences of the input configuration
      const inputOccurrences = (
        configContent.match(/input:\s*['"]src\/index\.ts['"]/g) || []
      ).length;
      expect(inputOccurrences).toBe(1);
    });

    it('should add multiple config entries for different targetFilePaths', () => {
      // First call
      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/index.ts',
      });

      // Second call with different targetFilePath
      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/handler.ts',
        bundleOutputDir: 'handler',
      });

      const configContent = tree.read(
        'apps/test-project/rolldown.config.ts',
        'utf-8',
      );

      expect(configContent).toContain('src/index.ts');
      expect(configContent).toContain('src/handler.ts');
      expect(configContent).toContain('bundle/index.js');
      expect(configContent).toContain('bundle/handler/index.js');
    });

    it('should configure rolldown with correct format and options', () => {
      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/index.ts',
      });

      const configContent = tree.read(
        'apps/test-project/rolldown.config.ts',
        'utf-8',
      );

      expect(configContent).toContain("format: 'cjs'");
      expect(configContent).toContain('inlineDynamicImports: true');
    });

    it('should work with nested project structure', () => {
      const nestedProject: ProjectConfiguration = {
        name: 'nested-project',
        root: 'libs/nested/project',
        sourceRoot: 'libs/nested/project/src',
        targets: {},
      };
      addProjectConfiguration(tree, nestedProject.name, nestedProject);

      addTypeScriptBundleTarget(tree, nestedProject, {
        targetFilePath: 'src/lib.ts',
      });

      expect(
        tree.exists('libs/nested/project/rolldown.config.ts'),
      ).toBeTruthy();

      const configContent = tree.read(
        'libs/nested/project/rolldown.config.ts',
        'utf-8',
      );
      expect(configContent).toContain(
        'dist/libs/nested/project/bundle/index.js',
      );
    });

    it('should configure external dependencies with strings', () => {
      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/index.ts',
        external: ['@aws-sdk/*', 'lodash'],
      });

      const configContent = tree.read(
        'apps/test-project/rolldown.config.ts',
        'utf-8',
      );

      expect(configContent).toContain("external: ['@aws-sdk/*', 'lodash']");
    });

    it('should configure external dependencies with regex patterns', () => {
      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/index.ts',
        external: [/@aws-sdk\/.*/, /^lodash/],
      });

      const configContent = tree.read(
        'apps/test-project/rolldown.config.ts',
        'utf-8',
      );

      expect(configContent).toContain('external: [/@aws-sdk\\/.*/, /^lodash/]');
    });

    it('should configure external dependencies with mixed strings and regex', () => {
      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/index.ts',
        external: ['@aws-sdk/*', /@types\/.*/, 'react'],
      });

      const configContent = tree.read(
        'apps/test-project/rolldown.config.ts',
        'utf-8',
      );

      expect(configContent).toContain(
        "external: ['@aws-sdk/*', /@types\\/.*/, 'react']",
      );
    });

    it('should not include external property when not provided', () => {
      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/index.ts',
      });

      const configContent = tree.read(
        'apps/test-project/rolldown.config.ts',
        'utf-8',
      );

      expect(configContent).not.toContain('external:');
    });

    it('should create build target if not present', () => {
      // Project has no build target initially
      expect(project.targets?.build).toBeUndefined();

      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/index.ts',
      });

      expect(project.targets?.build).toBeDefined();
      expect(project.targets?.build?.dependsOn).toContain('bundle');
    });

    it('should create build target with bundle dependency even when no other dependencies exist', () => {
      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/index.ts',
      });

      expect(project.targets?.build).toBeDefined();
      expect(project.targets?.build?.dependsOn).toEqual(['bundle']);
    });

    it('should handle external dependencies in multiple config entries', () => {
      // First call with external dependencies
      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/index.ts',
        external: ['@aws-sdk/*'],
      });

      // Second call with different external dependencies
      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/handler.ts',
        external: ['lodash', /@types\/.*/],
        bundleOutputDir: 'handler',
      });

      const configContent = tree.read(
        'apps/test-project/rolldown.config.ts',
        'utf-8',
      );

      expect(configContent).toContain("external: ['@aws-sdk/*']");
      expect(configContent).toContain("external: ['lodash', /@types\\/.*/]");
      expect(configContent).toContain('src/index.ts');
      expect(configContent).toContain('src/handler.ts');
    });

    it('should configure platform with default value of node', () => {
      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/index.ts',
      });

      const configContent = tree.read(
        'apps/test-project/rolldown.config.ts',
        'utf-8',
      );

      expect(configContent).toContain("platform: 'node'");
    });

    it('should configure platform when explicitly set to node', () => {
      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/index.ts',
        platform: 'node',
      });

      const configContent = tree.read(
        'apps/test-project/rolldown.config.ts',
        'utf-8',
      );

      expect(configContent).toContain("platform: 'node'");
    });

    it('should configure platform when set to browser', () => {
      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/index.ts',
        platform: 'browser',
      });

      const configContent = tree.read(
        'apps/test-project/rolldown.config.ts',
        'utf-8',
      );

      expect(configContent).toContain("platform: 'browser'");
    });

    it('should configure platform when set to neutral', () => {
      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/index.ts',
        platform: 'neutral',
      });

      const configContent = tree.read(
        'apps/test-project/rolldown.config.ts',
        'utf-8',
      );

      expect(configContent).toContain("platform: 'neutral'");
    });

    it('should add disableTreeShake function and plugins when AWS SDK is not external', () => {
      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/index.ts',
      });

      const configContent = tree.read(
        'apps/test-project/rolldown.config.ts',
        'utf-8',
      );

      // Should include the disableTreeShake function
      expect(configContent).toContain('const disableTreeShake');
      expect(configContent).toContain("name: 'disable-treeshake'");
      expect(configContent).toContain("moduleSideEffects: 'no-treeshake'");

      // Should include plugins configuration
      expect(configContent).toContain(
        'plugins: [disableTreeShake([/@aws-sdk\\/.*/])]',
      );

      expect(
        tree.read('apps/test-project/rolldown.config.ts', 'utf-8'),
      ).toMatchSnapshot();
    });

    it('should not add disableTreeShake or plugins when AWS SDK is external as regex', () => {
      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/index.ts',
        external: [/@aws-sdk\/.*/],
      });

      const configContent = tree.read(
        'apps/test-project/rolldown.config.ts',
        'utf-8',
      );

      // Should NOT include the disableTreeShake function
      expect(configContent).not.toContain('const disableTreeShake');
      expect(configContent).not.toContain("name: 'disable-treeshake'");

      // Should NOT include plugins configuration
      expect(configContent).not.toContain('plugins:');

      expect(
        tree.read('apps/test-project/rolldown.config.ts', 'utf-8'),
      ).toMatchSnapshot();
    });

    it('should not add disableTreeShake or plugins when AWS SDK is external with other dependencies', () => {
      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/index.ts',
        external: ['lodash', /@aws-sdk\/.*/, 'react'],
      });

      const configContent = tree.read(
        'apps/test-project/rolldown.config.ts',
        'utf-8',
      );

      // Should NOT include the disableTreeShake function
      expect(configContent).not.toContain('const disableTreeShake');

      // Should NOT include plugins configuration
      expect(configContent).not.toContain('plugins:');

      // Should still have external configuration
      expect(configContent).toContain('external:');
    });

    it('should add disableTreeShake only once when called multiple times', () => {
      // First call
      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/index.ts',
      });

      // Second call with different target
      addTypeScriptBundleTarget(tree, project, {
        targetFilePath: 'src/handler.ts',
        bundleOutputDir: 'handler',
      });

      const configContent = tree.read(
        'apps/test-project/rolldown.config.ts',
        'utf-8',
      );

      // Count occurrences of disableTreeShake function definition
      const disableTreeShakeOccurrences = (
        configContent.match(/const disableTreeShake = /g) || []
      ).length;
      expect(disableTreeShakeOccurrences).toBe(1);

      // Both configs should have plugins
      const pluginsOccurrences = (
        configContent.match(/plugins: \[disableTreeShake/g) || []
      ).length;
      expect(pluginsOccurrences).toBe(2);
    });
  });

  describe('addPythonBundleTarget', () => {
    let project: ProjectConfiguration;

    beforeEach(() => {
      project = {
        name: 'test-python-project',
        root: 'apps/test-python-project',
        sourceRoot: 'apps/test-python-project/src',
        targets: {},
      };
      addProjectConfiguration(tree, project.name, project);
    });

    it('should add python bundle target with default platform', () => {
      addPythonBundleTarget(project);

      // Should create bundle-x86 target for default x86 platform
      expect(project.targets?.['bundle-x86']).toBeDefined();
      expect(project.targets?.['bundle-x86']?.cache).toBe(true);
      expect(project.targets?.['bundle-x86']?.executor).toBe('nx:run-commands');
      expect(project.targets?.['bundle-x86']?.dependsOn).toContain('compile');

      const commands = project.targets?.['bundle-x86']?.options?.commands;
      expect(commands[1]).toContain('--python-platform x86_64-manylinux2014');

      // Should also create a generic bundle target that depends on bundle-x86
      expect(project.targets?.bundle).toBeDefined();
      expect(project.targets?.bundle?.dependsOn).toContain('bundle-x86');
    });

    it('should add python bundle target with custom platform', () => {
      addPythonBundleTarget(project, {
        pythonPlatform: 'aarch64-manylinux2014',
      });

      // Should create bundle-arm target for ARM platform
      expect(project.targets?.['bundle-arm']).toBeDefined();
      const commands = project.targets?.['bundle-arm']?.options?.commands;
      expect(commands[1]).toContain('--python-platform aarch64-manylinux2014');

      // Should also create a generic bundle target that depends on bundle-arm
      expect(project.targets?.bundle).toBeDefined();
      expect(project.targets?.bundle?.dependsOn).toContain('bundle-arm');
    });

    it('should not overwrite existing bundle-x86 target', () => {
      const existingBundleTarget = {
        cache: false,
        executor: 'custom:executor',
      };
      project.targets = { 'bundle-x86': existingBundleTarget };

      addPythonBundleTarget(project);

      expect(project.targets['bundle-x86']).toEqual(existingBundleTarget);
    });

    it('should add bundle dependency to build target', () => {
      project.targets = {
        build: {
          executor: 'nx:run-commands',
          dependsOn: ['test'],
        },
      };

      addPythonBundleTarget(project);

      expect(project.targets.build.dependsOn).toContain('bundle');
      expect(project.targets.build.dependsOn).toContain('test');
    });

    it('should handle project without existing targets', () => {
      const projectWithoutTargets: ProjectConfiguration = {
        name: 'test-python-project',
        root: 'apps/test-python-project',
      };

      addPythonBundleTarget(projectWithoutTargets);

      expect(projectWithoutTargets.targets).toBeDefined();
      expect(projectWithoutTargets.targets?.bundle).toBeDefined();
    });

    it('should create generic bundle target that depends on architecture-specific target', () => {
      addPythonBundleTarget(project, {
        pythonPlatform: 'x86_64-manylinux2014',
      });

      // Should create bundle-x86 target
      expect(project.targets?.['bundle-x86']).toBeDefined();

      // Should create generic bundle target that depends on bundle-x86
      expect(project.targets?.bundle).toBeDefined();
      expect(project.targets?.bundle?.dependsOn).toContain('bundle-x86');
    });

    it('should support adding both platform bundle targets to the same project', () => {
      // Add x86 bundle target
      addPythonBundleTarget(project, {
        pythonPlatform: 'x86_64-manylinux2014',
      });

      // Add ARM bundle target
      addPythonBundleTarget(project, {
        pythonPlatform: 'aarch64-manylinux2014',
      });

      // Should have both architecture-specific targets
      expect(project.targets?.['bundle-x86']).toBeDefined();
      expect(project.targets?.['bundle-arm']).toBeDefined();

      // Generic bundle target should depend on both
      expect(project.targets?.bundle).toBeDefined();
      expect(project.targets?.bundle?.dependsOn).toContain('bundle-x86');
      expect(project.targets?.bundle?.dependsOn).toContain('bundle-arm');

      // Verify each has correct platform in commands
      const x86Commands = project.targets?.['bundle-x86']?.options?.commands;
      const armCommands = project.targets?.['bundle-arm']?.options?.commands;

      expect(x86Commands[1]).toContain(
        '--python-platform x86_64-manylinux2014',
      );
      expect(armCommands[1]).toContain(
        '--python-platform aarch64-manylinux2014',
      );

      // Verify each has correct output path
      expect(project.targets?.['bundle-x86']?.outputs).toEqual([
        '{workspaceRoot}/dist/apps/test-python-project/bundle-x86',
      ]);
      expect(project.targets?.['bundle-arm']?.outputs).toEqual([
        '{workspaceRoot}/dist/apps/test-python-project/bundle-arm',
      ]);
    });
  });
});
