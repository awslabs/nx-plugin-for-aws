/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, Tree } from '@nx/devkit';
import {
  CLOUDSCAPE_WEBSITE_APP_GENERATOR_INFO,
  tsCloudScapeWebsiteGenerator,
} from './generator';
import { TsCloudScapeWebsiteGeneratorSchema } from './schema';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { expectHasMetricTags } from '../../utils/metrics.spec';

describe('cloudscape-website generator', () => {
  let tree: Tree;

  const options: TsCloudScapeWebsiteGeneratorSchema = {
    name: 'test-app',
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should generate base files and structure', async () => {
    await tsCloudScapeWebsiteGenerator(tree, options);
    // Check main application files
    expect(tree.exists('test-app/src/main.tsx')).toBeTruthy();
    expect(tree.exists('test-app/src/config.ts')).toBeTruthy();
    expect(tree.exists('test-app/src/routeTree.gen.ts')).toBeTruthy();
    expect(tree.exists('test-app/src/styles.css')).toBeTruthy();
    expect(tree.exists('test-app/src/routes/__root.tsx')).toBeTruthy();
    expect(tree.exists('test-app/src/routes/index.tsx')).toBeTruthy();
    expect(tree.exists('test-app/src/routes/welcome/index.tsx')).toBeTruthy();
    expect(
      tree.exists('test-app/src/components/AppLayout/index.tsx'),
    ).toBeTruthy();
    expect(
      tree.exists('test-app/src/components/AppLayout/navitems.ts'),
    ).toBeTruthy();
    // Snapshot the main application files
    expect(tree.read('test-app/src/main.tsx')?.toString()).toMatchSnapshot(
      'main.tsx',
    );
    expect(tree.read('test-app/src/config.ts')?.toString()).toMatchSnapshot(
      'config.ts',
    );
    expect(
      tree.read('test-app/src/components/AppLayout/index.tsx')?.toString(),
    ).toMatchSnapshot('app-layout.tsx');
    expect(
      tree.read('test-app/src/routes/welcome/index.tsx')?.toString(),
    ).toMatchSnapshot('welcome-index.tsx');
  });

  it('should configure vite correctly', async () => {
    await tsCloudScapeWebsiteGenerator(tree, options);
    const viteConfig = tree.read('test-app/vite.config.ts')?.toString();
    expect(viteConfig).toBeDefined();
    expect(viteConfig).toMatchSnapshot('vite.config.ts');
  });

  it('should generate shared constructs', async () => {
    await tsCloudScapeWebsiteGenerator(tree, options);
    // Check shared constructs files
    expect(
      tree.exists(
        'packages/common/constructs/src/app/static-websites/index.ts',
      ),
    ).toBeTruthy();
    expect(
      tree.exists(
        'packages/common/constructs/src/app/static-websites/test-app.ts',
      ),
    ).toBeTruthy();
    expect(
      tree.exists('packages/common/constructs/src/core/index.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('packages/common/constructs/src/core/static-website.ts'),
    ).toBeTruthy();
    // Snapshot the shared constructs files
    expect(
      tree
        .read('packages/common/constructs/src/app/static-websites/index.ts')
        ?.toString(),
    ).toMatchSnapshot('common/constructs-app-index.ts');
    expect(
      tree
        .read('packages/common/constructs/src/app/static-websites/test-app.ts')
        ?.toString(),
    ).toMatchSnapshot('test-app.ts');
    expect(
      tree.read('packages/common/constructs/src/core/index.ts')?.toString(),
    ).toMatchSnapshot('common/constructs-core-index.ts');
    expect(
      tree
        .read('packages/common/constructs/src/core/static-website.ts')
        ?.toString(),
    ).toMatchSnapshot('common/constructs-core-static-website.ts');
  });

  it('should update package.json with required dependencies', async () => {
    await tsCloudScapeWebsiteGenerator(tree, options);
    const packageJson = JSON.parse(tree.read('package.json').toString());
    // Check for website dependencies
    expect(packageJson.dependencies).toMatchObject({
      '@cloudscape-design/components': expect.any(String),
      '@cloudscape-design/board-components': expect.any(String),
      '@tanstack/react-router': expect.any(String),
    });
    // Check for AWS CDK dependencies
    expect(packageJson.dependencies).toMatchObject({
      constructs: expect.any(String),
      'aws-cdk-lib': expect.any(String),
    });
  });

  it('should configure TypeScript correctly', async () => {
    await tsCloudScapeWebsiteGenerator(tree, options);
    const tsConfig = JSON.parse(tree.read('test-app/tsconfig.json').toString());
    expect(tsConfig.compilerOptions.moduleResolution).toBe('Bundler');
    expect(tsConfig).toMatchSnapshot('tsconfig.json');
  });

  it('should handle custom directory option', async () => {
    await tsCloudScapeWebsiteGenerator(tree, {
      ...options,
      directory: 'custom-dir',
    });
    expect(tree.exists('custom-dir/test-app/src/main.tsx')).toBeTruthy();
    expect(
      tree.read('custom-dir/test-app/src/main.tsx')?.toString(),
    ).toMatchSnapshot('custom-dir-main.tsx');
  });

  it('should handle npm scope prefix correctly', async () => {
    // Set up package.json with a scope
    tree.write(
      'package.json',
      JSON.stringify({
        name: '@test-scope/root',
        version: '0.0.0',
      }),
    );
    await tsCloudScapeWebsiteGenerator(tree, options);
    const packageJson = JSON.parse(tree.read('package.json').toString());
    expect(packageJson.dependencies).toMatchSnapshot('scoped-dependencies');
  });

  it('should add generator to project metadata', async () => {
    // Call the generator function
    await tsCloudScapeWebsiteGenerator(tree, options);

    expect(readJson(tree, 'test-app/project.json').metadata).toHaveProperty(
      'generator',
      CLOUDSCAPE_WEBSITE_APP_GENERATOR_INFO.id,
    );
  });

  it('should add a serve-local target with mode serve-local', async () => {
    // Call the generator function
    await tsCloudScapeWebsiteGenerator(tree, options);

    const projectConfig = readJson(tree, 'test-app/project.json');
    expect(projectConfig.targets).toHaveProperty('serve-local');
    expect(projectConfig.targets['serve-local'].options).toHaveProperty(
      'mode',
      'serve-local',
    );
    expect(projectConfig.targets['serve-local'].continuous).toBeTruthy();
  });

  it('should add generator metric to app.ts', async () => {
    // Call the generator function
    await tsCloudScapeWebsiteGenerator(tree, options);

    // Verify the metric was added to app.ts
    expectHasMetricTags(tree, CLOUDSCAPE_WEBSITE_APP_GENERATOR_INFO.metric);
  });
});
