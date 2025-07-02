/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, Tree } from '@nx/devkit';
import {
  REACT_WEBSITE_APP_GENERATOR_INFO,
  tsReactWebsiteGenerator,
} from './generator';
import { TsReactWebsiteGeneratorSchema } from './schema';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import { expectHasMetricTags } from '../../../utils/metrics.spec';

describe('react-website generator', () => {
  let tree: Tree;

  const options: TsReactWebsiteGeneratorSchema = {
    name: 'test-app',
  };

  const optionsWithoutTailwind: TsReactWebsiteGeneratorSchema = {
    name: 'test-app',
    enableTailwind: false,
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should generate base files and structure', async () => {
    await tsReactWebsiteGenerator(tree, options);
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
    await tsReactWebsiteGenerator(tree, options);
    const viteConfig = tree.read('test-app/vite.config.ts')?.toString();
    expect(viteConfig).toBeDefined();
    expect(viteConfig).toMatchSnapshot('vite.config.ts');
  });

  it('should generate shared constructs', async () => {
    await tsReactWebsiteGenerator(tree, options);
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
    await tsReactWebsiteGenerator(tree, options);
    const packageJson = JSON.parse(tree.read('package.json').toString());
    // Check for website dependencies
    expect(packageJson.dependencies).toMatchObject({
      '@cloudscape-design/components': expect.any(String),
      '@cloudscape-design/board-components': expect.any(String),
      '@tanstack/react-router': expect.any(String),
    });
    // Check for TailwindCSS dependencies (enabled by default)
    expect(packageJson.dependencies).toMatchObject({
      tailwindcss: expect.any(String),
    });
    expect(packageJson.devDependencies).toMatchObject({
      '@tailwindcss/vite': expect.any(String),
    });

    // Check for AWS CDK dependencies
    expect(packageJson.dependencies).toMatchObject({
      constructs: expect.any(String),
      'aws-cdk-lib': expect.any(String),
    });
  });

  it('should configure TypeScript correctly', async () => {
    await tsReactWebsiteGenerator(tree, options);
    const tsConfig = JSON.parse(tree.read('test-app/tsconfig.json').toString());
    expect(tsConfig.compilerOptions.moduleResolution).toBe('Bundler');
    expect(tsConfig).toMatchSnapshot('tsconfig.json');
  });

  it('should handle custom directory option', async () => {
    await tsReactWebsiteGenerator(tree, {
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
    await tsReactWebsiteGenerator(tree, options);
    const packageJson = JSON.parse(tree.read('package.json').toString());
    expect(packageJson.dependencies).toMatchSnapshot('scoped-dependencies');
  });

  it('should add generator to project metadata', async () => {
    // Call the generator function
    await tsReactWebsiteGenerator(tree, options);

    expect(readJson(tree, 'test-app/project.json').metadata).toHaveProperty(
      'generator',
      REACT_WEBSITE_APP_GENERATOR_INFO.id,
    );
  });

  it('should add a serve-local target with mode serve-local', async () => {
    // Call the generator function
    await tsReactWebsiteGenerator(tree, options);

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
    await tsReactWebsiteGenerator(tree, options);

    // Verify the metric was added to app.ts
    expectHasMetricTags(tree, REACT_WEBSITE_APP_GENERATOR_INFO.metric);
  });

  describe('TailwindCSS integration', () => {
    it('should include TailwindCSS dependencies by default', async () => {
      await tsReactWebsiteGenerator(tree, options);
      const packageJson = JSON.parse(tree.read('package.json').toString());

      // Check for TailwindCSS dependencies
      expect(packageJson.dependencies).toHaveProperty('tailwindcss');
      expect(packageJson.devDependencies).toHaveProperty('@tailwindcss/vite');
    });

    it('should configure vite with TailwindCSS plugin by default', async () => {
      await tsReactWebsiteGenerator(tree, options);
      const viteConfig = tree.read('test-app/vite.config.ts')?.toString();

      expect(viteConfig).toBeDefined();
      expect(viteConfig).toContain(
        "import tailwindcss from '@tailwindcss/vite'",
      );
      expect(viteConfig).toContain('tailwindcss()');
      expect(viteConfig).toMatchSnapshot('vite.config.ts-with-tailwind');
    });

    it('should include TailwindCSS import in styles.css by default', async () => {
      await tsReactWebsiteGenerator(tree, options);
      const stylesContent = tree.read('test-app/src/styles.css')?.toString();

      expect(stylesContent).toBeDefined();
      expect(stylesContent).toContain("@import 'tailwindcss'");
      expect(stylesContent).toMatchSnapshot('styles.css-with-tailwind');
    });

    it('should not include TailwindCSS when disabled', async () => {
      await tsReactWebsiteGenerator(tree, optionsWithoutTailwind);
      const packageJson = JSON.parse(tree.read('package.json').toString());

      // Check that TailwindCSS dependencies are NOT included
      expect(packageJson.dependencies).not.toHaveProperty('tailwindcss');
      expect(packageJson.devDependencies).not.toHaveProperty(
        '@tailwindcss/vite',
      );
    });

    it('should configure vite without TailwindCSS plugin when disabled', async () => {
      await tsReactWebsiteGenerator(tree, optionsWithoutTailwind);
      const viteConfig = tree.read('test-app/vite.config.ts')?.toString();

      expect(viteConfig).toBeDefined();
      expect(viteConfig).not.toContain(
        "import tailwindcss from '@tailwindcss/vite'",
      );
      expect(viteConfig).not.toContain('tailwindcss()');
      expect(viteConfig).toMatchSnapshot('vite.config.ts-without-tailwind');
    });

    it('should not include TailwindCSS import in styles.css when disabled', async () => {
      await tsReactWebsiteGenerator(tree, optionsWithoutTailwind);
      const stylesContent = tree.read('test-app/src/styles.css')?.toString();

      expect(stylesContent).toBeDefined();
      expect(stylesContent).not.toContain('@import "tailwindcss"');
      expect(stylesContent).toMatchSnapshot('styles.css-without-tailwind');
    });

    it('should handle enableTailwind explicitly set to true', async () => {
      await tsReactWebsiteGenerator(tree, { ...options, enableTailwind: true });
      const packageJson = JSON.parse(tree.read('package.json').toString());
      const viteConfig = tree.read('test-app/vite.config.ts')?.toString();
      const stylesContent = tree.read('test-app/src/styles.css')?.toString();

      // Verify TailwindCSS is included
      expect(packageJson.dependencies).toHaveProperty('tailwindcss');
      expect(packageJson.devDependencies).toHaveProperty('@tailwindcss/vite');
      expect(viteConfig).toContain('tailwindcss()');
      expect(stylesContent).toContain("@import 'tailwindcss'");
    });
  });
});
