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
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../../../utils/config/utils';

describe('react-website generator', () => {
  let tree: Tree;

  const options: TsReactWebsiteGeneratorSchema = {
    name: 'test-app',
    iacProvider: 'CDK',
  };

  const optionsWithoutTailwind: TsReactWebsiteGeneratorSchema = {
    name: 'test-app',
    enableTailwind: false,
    iacProvider: 'CDK',
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
    expect(
      tree.exists('test-app/src/components/AppLayout/index.tsx'),
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
      tree.read('test-app/src/routes/index.tsx')?.toString(),
    ).toMatchSnapshot('index.tsx');
  });

  it('should configure vite correctly', async () => {
    await tsReactWebsiteGenerator(tree, options);
    const viteConfig = tree.read('test-app/vite.config.mts')?.toString();
    expect(viteConfig).toBeDefined();
    expect(viteConfig).toMatchSnapshot('vite.config.mts');
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

  describe('Tanstack router integration', () => {
    it('should generate website with no router correctly', async () => {
      await tsReactWebsiteGenerator(tree, {
        ...options,
        enableTanstackRouter: false,
      });

      tree
        .listChanges()
        .filter((change) => change.type !== 'DELETE')
        .forEach((change) =>
          expect(change.content.toString('utf-8')).toMatchSnapshot(change.path),
        );
    });

    it('should generate website with router correctly', async () => {
      await tsReactWebsiteGenerator(tree, options);

      tree
        .listChanges()
        .filter((change) => change.type !== 'DELETE')
        .forEach((change) =>
          expect(change.content.toString('utf-8')).toMatchSnapshot(change.path),
        );
    });
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
      const viteConfig = tree.read('test-app/vite.config.mts')?.toString();

      expect(viteConfig).toBeDefined();
      expect(viteConfig).toContain(
        "import tailwindcss from '@tailwindcss/vite'",
      );
      expect(viteConfig).toContain('tailwindcss()');
      expect(viteConfig).toMatchSnapshot('vite.config.mts-with-tailwind');
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
      const viteConfig = tree.read('test-app/vite.config.mts')?.toString();

      expect(viteConfig).toBeDefined();
      expect(viteConfig).not.toContain(
        "import tailwindcss from '@tailwindcss/vite'",
      );
      expect(viteConfig).not.toContain('tailwindcss()');
      expect(viteConfig).toMatchSnapshot('vite.config.mts-without-tailwind');
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
      const viteConfig = tree.read('test-app/vite.config.mts')?.toString();
      const stylesContent = tree.read('test-app/src/styles.css')?.toString();

      // Verify TailwindCSS is included
      expect(packageJson.dependencies).toHaveProperty('tailwindcss');
      expect(packageJson.devDependencies).toHaveProperty('@tailwindcss/vite');
      expect(viteConfig).toContain('tailwindcss()');
      expect(stylesContent).toContain("@import 'tailwindcss'");
    });

    describe('terraform iacProvider', () => {
      it('should generate terraform files for static website and snapshot them', async () => {
        await tsReactWebsiteGenerator(tree, {
          ...options,
          iacProvider: 'Terraform',
        });

        // Find all terraform files
        const allFiles = tree.listChanges().map((f) => f.path);
        const terraformFiles = allFiles.filter(
          (f) => f.includes('terraform') && f.endsWith('.tf'),
        );

        // Verify terraform files are created
        expect(terraformFiles.length).toBeGreaterThan(0);

        // Find the specific terraform files
        const coreStaticWebsiteFile = terraformFiles.find((f) =>
          f.includes('static-website'),
        );
        const appWebsiteFile = terraformFiles.find((f) =>
          f.includes('test-app'),
        );

        expect(coreStaticWebsiteFile).toBeDefined();
        expect(appWebsiteFile).toBeDefined();

        // Read terraform file contents
        const coreStaticWebsiteContent = tree.read(
          coreStaticWebsiteFile!,
          'utf-8',
        );
        const appWebsiteContent = tree.read(appWebsiteFile!, 'utf-8');

        // Verify static website configuration
        expect(appWebsiteContent).toContain('module "static_website"');
        expect(appWebsiteContent).toContain(
          'source = "../../../core/static-website"',
        );
        expect(appWebsiteContent).toContain('website_name      = "test-app"');

        // Snapshot terraform files
        const terraformFileContents = {
          'static-website.tf': coreStaticWebsiteContent,
          'test-app.tf': appWebsiteContent,
        };

        expect(terraformFileContents).toMatchSnapshot(
          'terraform-static-website-files',
        );
      });

      it('should configure project targets and dependencies correctly for terraform', async () => {
        await tsReactWebsiteGenerator(tree, {
          ...options,
          iacProvider: 'Terraform',
        });

        // Check that shared terraform project has build dependency on the website project
        const sharedTerraformConfig = JSON.parse(
          tree.read('packages/common/terraform/project.json', 'utf-8'),
        );

        // The dependency should include the project name (may be fully qualified)
        const buildDependencies = sharedTerraformConfig.targets.build.dependsOn;
        expect(
          buildDependencies.some(
            (dep: string) => dep.includes('test-app') && dep.includes('build'),
          ),
        ).toBeTruthy();

        // Verify project configuration has correct targets
        const projectConfig = JSON.parse(
          tree.read('test-app/project.json', 'utf-8'),
        );

        // Should still have basic website targets
        expect(projectConfig.targets.build).toBeDefined();
        expect(projectConfig.targets['serve-local']).toBeDefined();
      });

      it('should not create CDK constructs when using terraform', async () => {
        await tsReactWebsiteGenerator(tree, {
          ...options,
          iacProvider: 'Terraform',
        });

        // Verify CDK files are NOT created
        expect(
          tree.exists(
            'packages/common/constructs/src/app/static-websites/test-app.ts',
          ),
        ).toBeFalsy();
        expect(
          tree.exists('packages/common/constructs/src/core/static-website.ts'),
        ).toBeFalsy();
      });

      it('should throw error for invalid iacProvider', async () => {
        await expect(
          tsReactWebsiteGenerator(tree, {
            ...options,
            iacProvider: 'InvalidProvider' as any,
          }),
        ).rejects.toThrow(
          'Unknown iacProvider: InvalidProvider. Supported providers are: CDK, Terraform',
        );
      });

      it('should handle terraform with different directory structures', async () => {
        await tsReactWebsiteGenerator(tree, {
          ...options,
          name: 'nested-website',
          directory: 'apps/nested/path',
          iacProvider: 'Terraform',
        });

        // Verify terraform files are created
        const allFiles = tree.listChanges().map((f) => f.path);
        const terraformFiles = allFiles.filter(
          (f) => f.includes('terraform') && f.endsWith('.tf'),
        );

        expect(terraformFiles.length).toBeGreaterThan(0);

        // Find the app-specific terraform file
        const appWebsiteFile = terraformFiles.find((f) =>
          f.includes('nested-website'),
        );
        expect(appWebsiteFile).toBeDefined();

        const terraformContent = tree.read(appWebsiteFile!, 'utf-8');

        // Verify the correct build path is used for nested directories
        expect(terraformContent).toContain(
          'dist/apps/nested/path/nested-website',
        );
        expect(terraformContent).toContain(
          'website_name      = "nested-website"',
        );
      });

      it('should generate terraform files with custom directory option', async () => {
        await tsReactWebsiteGenerator(tree, {
          ...options,
          directory: 'custom-dir',
          iacProvider: 'Terraform',
        });

        // Find all terraform files
        const allFiles = tree.listChanges().map((f) => f.path);
        const terraformFiles = allFiles.filter(
          (f) => f.includes('terraform') && f.endsWith('.tf'),
        );

        // Verify terraform files are created
        expect(terraformFiles.length).toBeGreaterThan(0);

        // Find the app-specific terraform file
        const appWebsiteFile = terraformFiles.find((f) =>
          f.includes('test-app'),
        );
        expect(appWebsiteFile).toBeDefined();

        const terraformContent = tree.read(appWebsiteFile!, 'utf-8');

        // Verify the correct build path is used for custom directory
        expect(terraformContent).toContain('dist/custom-dir/test-app');
      });

      it('should handle enableTailwind option correctly in terraform', async () => {
        await tsReactWebsiteGenerator(tree, {
          ...options,
          enableTailwind: false,
          iacProvider: 'Terraform',
        });

        // Find the app-specific terraform file
        const allFiles = tree.listChanges().map((f) => f.path);
        const terraformFiles = allFiles.filter(
          (f) => f.includes('terraform') && f.endsWith('.tf'),
        );
        const appWebsiteFile = terraformFiles.find((f) =>
          f.includes('test-app'),
        );
        expect(appWebsiteFile).toBeDefined();

        const terraformContent = tree.read(appWebsiteFile!, 'utf-8');

        // Basic terraform configuration should still be present
        expect(terraformContent).toContain('module "static_website"');
        expect(terraformContent).toContain('website_name      = "test-app"');
      });

      it('should handle enableTanstackRouter option correctly in terraform', async () => {
        await tsReactWebsiteGenerator(tree, {
          ...options,
          enableTanstackRouter: false,
          iacProvider: 'Terraform',
        });

        // Find the app-specific terraform file
        const allFiles = tree.listChanges().map((f) => f.path);
        const terraformFiles = allFiles.filter(
          (f) => f.includes('terraform') && f.endsWith('.tf'),
        );
        const appWebsiteFile = terraformFiles.find((f) =>
          f.includes('test-app'),
        );
        expect(appWebsiteFile).toBeDefined();

        const terraformContent = tree.read(appWebsiteFile!, 'utf-8');

        // Basic terraform configuration should still be present
        expect(terraformContent).toContain('module "static_website"');
        expect(terraformContent).toContain('website_name      = "test-app"');
      });
    });
  });

  describe('load:runtime-config target', () => {
    it('should configure load:runtime-config target for CDK provider', async () => {
      await tsReactWebsiteGenerator(tree, {
        ...options,
        iacProvider: 'CDK',
      });

      const projectConfig = readJson(tree, 'test-app/project.json');
      const loadRuntimeConfigTarget =
        projectConfig.targets['load:runtime-config'];

      expect(loadRuntimeConfigTarget).toBeDefined();
      expect(loadRuntimeConfigTarget.executor).toBe('nx:run-commands');
      expect(loadRuntimeConfigTarget.metadata.description).toContain(
        'Load runtime config from your deployed stack for dev purposes',
      );
      expect(loadRuntimeConfigTarget.options.command).toContain('aws s3 cp');
      expect(loadRuntimeConfigTarget.options.command).toContain(
        'aws cloudformation describe-stacks',
      );
      expect(loadRuntimeConfigTarget.options.command).toContain(
        'TestAppWebsiteBucketName',
      );
    });

    it('should configure load:runtime-config target for Terraform provider', async () => {
      await tsReactWebsiteGenerator(tree, {
        ...options,
        iacProvider: 'Terraform',
      });

      const projectConfig = readJson(tree, 'test-app/project.json');
      const loadRuntimeConfigTarget =
        projectConfig.targets['load:runtime-config'];

      expect(loadRuntimeConfigTarget).toBeDefined();
      expect(loadRuntimeConfigTarget.executor).toBe('nx:run-commands');
      expect(loadRuntimeConfigTarget.options.command).toContain('node -e');
      expect(loadRuntimeConfigTarget.options.command).toContain(
        'fs.copyFileSync',
      );
      expect(loadRuntimeConfigTarget.options.env).toEqual({
        SRC_FILE: 'dist/packages/common/terraform/runtime-config.json',
        DEST_DIR: '{projectRoot}/public',
        DEST_FILE: '{projectRoot}/public/runtime-config.json',
      });
    });

    it('should throw error for unknown iacProvider', async () => {
      await expect(
        tsReactWebsiteGenerator(tree, {
          ...options,
          iacProvider: 'UnknownProvider' as any,
        }),
      ).rejects.toThrow(
        'Unknown iacProvider: UnknownProvider. Supported providers are: CDK, Terraform',
      );
    });

    it('should configure load:runtime-config target with custom directory for Terraform', async () => {
      await tsReactWebsiteGenerator(tree, {
        ...options,
        directory: 'custom-dir',
        iacProvider: 'Terraform',
      });

      const projectConfig = readJson(tree, 'custom-dir/test-app/project.json');
      const loadRuntimeConfigTarget =
        projectConfig.targets['load:runtime-config'];

      expect(loadRuntimeConfigTarget).toBeDefined();
      expect(loadRuntimeConfigTarget.options.env.SRC_FILE).toBe(
        'dist/packages/common/terraform/runtime-config.json',
      );
      expect(loadRuntimeConfigTarget.options.env.DEST_DIR).toBe(
        '{projectRoot}/public',
      );
      expect(loadRuntimeConfigTarget.options.env.DEST_FILE).toBe(
        '{projectRoot}/public/runtime-config.json',
      );
    });

    it('should configure load:runtime-config target with scoped npm prefix for CDK', async () => {
      // Set up package.json with a scope
      tree.write(
        'package.json',
        JSON.stringify({
          name: '@test-scope/root',
          version: '0.0.0',
        }),
      );

      await tsReactWebsiteGenerator(tree, {
        ...options,
        iacProvider: 'CDK',
      });

      const projectConfig = readJson(tree, 'test-app/project.json');
      const loadRuntimeConfigTarget =
        projectConfig.targets['load:runtime-config'];

      expect(loadRuntimeConfigTarget.options.command).toContain('test-scope-');
      expect(loadRuntimeConfigTarget.options.command).toContain(
        'TestAppWebsiteBucketName',
      );
    });
  });

  it('should inherit iacProvider from config when set to Inherit', async () => {
    // Set up config with CDK provider using utility methods
    await ensureAwsNxPluginConfig(tree);
    await updateAwsNxPluginConfig(tree, {
      iac: {
        provider: 'CDK',
      },
    });

    await tsReactWebsiteGenerator(tree, {
      ...options,
      iacProvider: 'Inherit',
    });

    // Verify CDK constructs are created (not terraform)
    expect(tree.exists('packages/common/constructs')).toBeTruthy();
    expect(tree.exists('packages/common/terraform')).toBeFalsy();
    expect(
      tree.exists(
        'packages/common/constructs/src/app/static-websites/test-app.ts',
      ),
    ).toBeTruthy();
  });
});
