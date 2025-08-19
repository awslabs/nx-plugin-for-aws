/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { ProjectConfiguration } from '@nx/devkit';
import { addEsbuildBundleTarget, AddEsbuildBundleTargetProps } from './esbuild';

describe('esbuild utils', () => {
  describe('addEsbuildBundleTarget', () => {
    let projectConfig: ProjectConfiguration;
    let props: AddEsbuildBundleTargetProps;

    beforeEach(() => {
      projectConfig = {
        name: 'test-project',
        root: 'packages/test-project',
        sourceRoot: 'packages/test-project/src',
        targets: {
          compile: {
            executor: '@nx/js:tsc',
          },
        },
      };

      props = {
        bundleTargetName: 'bundle-test-function',
        targetFilePath: 'packages/test-project/src/test-function.ts',
      };
    });

    it('should add esbuild bundle target with basic configuration', () => {
      addEsbuildBundleTarget(projectConfig, props);

      const bundleTarget = projectConfig.targets![props.bundleTargetName];
      expect(bundleTarget).toBeDefined();
      expect(bundleTarget.cache).toBe(true);
      expect(bundleTarget.executor).toBe('nx:run-commands');
      expect(bundleTarget.outputs).toEqual([
        `{workspaceRoot}/dist/${projectConfig.root}/${props.bundleTargetName}`,
      ]);
      expect(bundleTarget.options.parallel).toBe(false);
      expect(bundleTarget.dependsOn).toEqual(['compile']);
    });

    it('should generate correct esbuild command without extra args', () => {
      addEsbuildBundleTarget(projectConfig, props);

      const bundleTarget = projectConfig.targets![props.bundleTargetName];
      expect(bundleTarget.options.commands).toHaveLength(1);
      expect(bundleTarget.options.commands[0]).toBe(
        'esbuild packages/test-project/src/test-function.ts --bundle --platform=node --target=node22 --format=cjs --outfile=dist/packages/test-project/bundle-test-function/index.js',
      );
    });

    it('should generate correct esbuild command with extra args', () => {
      const propsWithExtraArgs = {
        ...props,
        extraEsbuildArgs: '--external:@aws-sdk/*',
      };

      addEsbuildBundleTarget(projectConfig, propsWithExtraArgs);

      const bundleTarget = projectConfig.targets![props.bundleTargetName];
      expect(bundleTarget.options.commands[0]).toBe(
        'esbuild packages/test-project/src/test-function.ts --bundle --platform=node --target=node22 --format=cjs --outfile=dist/packages/test-project/bundle-test-function/index.js --external:@aws-sdk/*',
      );
    });

    it('should include post bundle commands when provided', () => {
      const propsWithPostCommands = {
        ...props,
        postBundleCommands: ['echo "Bundle complete"', 'npm run post-process'],
      };

      addEsbuildBundleTarget(projectConfig, propsWithPostCommands);

      const bundleTarget = projectConfig.targets![props.bundleTargetName];
      expect(bundleTarget.options.commands).toHaveLength(3);
      expect(bundleTarget.options.commands[1]).toBe('echo "Bundle complete"');
      expect(bundleTarget.options.commands[2]).toBe('npm run post-process');
    });

    it('should create targets object if it does not exist', () => {
      projectConfig.targets = undefined;

      addEsbuildBundleTarget(projectConfig, props);

      expect(projectConfig.targets).toBeDefined();
      expect(projectConfig.targets![props.bundleTargetName]).toBeDefined();
    });

    it('should create bundle target when it does not exist', () => {
      addEsbuildBundleTarget(projectConfig, props);

      const bundleTarget = projectConfig.targets!.bundle;
      expect(bundleTarget).toBeDefined();
      expect(bundleTarget.cache).toBe(true);
      expect(bundleTarget.dependsOn).toEqual([props.bundleTargetName]);
    });

    it('should update existing bundle target dependsOn', () => {
      projectConfig.targets!.bundle = {
        cache: true,
        dependsOn: ['existing-target'],
      };

      addEsbuildBundleTarget(projectConfig, props);

      const bundleTarget = projectConfig.targets!.bundle;
      expect(bundleTarget.dependsOn).toEqual([
        'existing-target',
        props.bundleTargetName,
      ]);
    });

    it('should not duplicate bundle target in dependsOn', () => {
      projectConfig.targets!.bundle = {
        cache: true,
        dependsOn: ['existing-target', props.bundleTargetName],
      };

      addEsbuildBundleTarget(projectConfig, props);

      const bundleTarget = projectConfig.targets!.bundle;
      expect(bundleTarget.dependsOn).toEqual([
        'existing-target',
        props.bundleTargetName,
      ]);
    });

    it('should handle bundle target with undefined dependsOn', () => {
      projectConfig.targets!.bundle = {
        cache: true,
      };

      addEsbuildBundleTarget(projectConfig, props);

      const bundleTarget = projectConfig.targets!.bundle;
      expect(bundleTarget.dependsOn).toEqual([props.bundleTargetName]);
    });

    it('should create build target when it does not exist', () => {
      delete projectConfig.targets!.build;

      addEsbuildBundleTarget(projectConfig, props);

      const buildTarget = projectConfig.targets!.build;
      expect(buildTarget).toBeDefined();
      expect(buildTarget.dependsOn).toEqual(['bundle']);
    });

    it('should update existing build target dependsOn', () => {
      projectConfig.targets!.build = {
        executor: '@nx/js:tsc',
        dependsOn: ['other-target'],
      };

      addEsbuildBundleTarget(projectConfig, props);

      const buildTarget = projectConfig.targets!.build;
      expect(buildTarget.dependsOn).toEqual(['other-target', 'bundle']);
    });

    it('should not duplicate bundle in build target dependsOn', () => {
      projectConfig.targets!.build = {
        executor: '@nx/js:tsc',
        dependsOn: ['other-target', 'bundle'],
      };

      addEsbuildBundleTarget(projectConfig, props);

      const buildTarget = projectConfig.targets!.build;
      expect(buildTarget.dependsOn).toEqual(['other-target', 'bundle']);
    });

    it('should handle build target with undefined dependsOn', () => {
      projectConfig.targets!.build = {
        executor: '@nx/js:tsc',
      };

      addEsbuildBundleTarget(projectConfig, props);

      const buildTarget = projectConfig.targets!.build;
      expect(buildTarget.dependsOn).toEqual(['bundle']);
    });

    it('should work with different project root paths', () => {
      projectConfig.root = 'apps/my-app';
      props.targetFilePath = 'apps/my-app/src/handler.ts';
      props.bundleTargetName = 'bundle-handler';

      addEsbuildBundleTarget(projectConfig, props);

      const bundleTarget = projectConfig.targets![props.bundleTargetName];
      expect(bundleTarget.outputs).toEqual([
        '{workspaceRoot}/dist/apps/my-app/bundle-handler',
      ]);
      expect(bundleTarget.options.commands[0]).toBe(
        'esbuild apps/my-app/src/handler.ts --bundle --platform=node --target=node22 --format=cjs --outfile=dist/apps/my-app/bundle-handler/index.js',
      );
    });

    it('should work with complex bundle target names', () => {
      props.bundleTargetName = 'bundle-complex-function-name';

      addEsbuildBundleTarget(projectConfig, props);

      const bundleTarget = projectConfig.targets![props.bundleTargetName];
      expect(bundleTarget).toBeDefined();
      expect(projectConfig.targets!.bundle.dependsOn).toContain(
        props.bundleTargetName,
      );
    });

    it('should combine extra args and post bundle commands', () => {
      const complexProps = {
        ...props,
        extraEsbuildArgs: '--external:@aws-sdk/* --minify',
        postBundleCommands: [
          'cp dist/bundle.js dist/final.js',
          'gzip dist/final.js',
        ],
      };

      addEsbuildBundleTarget(projectConfig, complexProps);

      const bundleTarget = projectConfig.targets![props.bundleTargetName];
      expect(bundleTarget.options.commands).toHaveLength(3);
      expect(bundleTarget.options.commands[0]).toBe(
        'esbuild packages/test-project/src/test-function.ts --bundle --platform=node --target=node22 --format=cjs --outfile=dist/packages/test-project/bundle-test-function/index.js --external:@aws-sdk/* --minify',
      );
      expect(bundleTarget.options.commands[1]).toBe(
        'cp dist/bundle.js dist/final.js',
      );
      expect(bundleTarget.options.commands[2]).toBe('gzip dist/final.js');
    });
  });
});
