/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, type Tree } from '@nx/devkit';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../../../utils/config/utils';
import { expectHasMetricTags } from '../../../utils/metrics.spec';
import {
  createTreeUsingTsSolutionSetup,
  snapshotTreeDir,
} from '../../../utils/test';
import {
  REACT_WEBSITE_APP_GENERATOR_INFO,
  SUPPORTED_UX_PROVIDERS,
  tsReactWebsiteGenerator,
} from './generator';
import type { TsReactWebsiteGeneratorSchema } from './schema';

describe('react-website generator', () => {
  let tree: Tree;

  const options: TsReactWebsiteGeneratorSchema = {
    name: 'test-app',
    iac: 'cdk',
    ux: 'cloudscape',
  };

  const optionsWithoutTailwind: TsReactWebsiteGeneratorSchema = {
    name: 'test-app',
    tailwind: false,
    iac: 'cdk',
    ux: 'cloudscape',
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
    // Check for Tanstack router dependencies
    expect(packageJson.dependencies).toMatchObject({
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

  it('should add a dev target with mode local-dev', async () => {
    // Call the generator function
    await tsReactWebsiteGenerator(tree, options);

    const projectConfig = readJson(tree, 'test-app/project.json');
    expect(projectConfig.targets).toHaveProperty('dev');
    expect(projectConfig.targets['dev'].executor).toBe('nx:run-commands');
    expect(projectConfig.targets['dev'].options.command).toContain(
      '--mode local-dev',
    );
    expect(projectConfig.targets['dev'].continuous).toBeTruthy();
  });

  it('should map the inferred vite dev-server target onto serve', async () => {
    await tsReactWebsiteGenerator(tree, options);

    // The @nx/vite plugin's inferred dev-server targets are both mapped onto
    // `serve` so the plugin does not emit its own `dev` target.
    const nxJson = readJson(tree, 'nx.json');
    const vitePlugin = nxJson.plugins.find(
      (p) => typeof p !== 'string' && p.plugin === '@nx/vite/plugin',
    );
    expect(vitePlugin.options.serveTargetName).toBe('serve');
    expect(vitePlugin.options.devTargetName).toBe('serve');
  });

  it('should expose the deployable bundle via the bundle target and aggregate it under build', async () => {
    await tsReactWebsiteGenerator(tree, options);

    // build aggregates lint/compile/test and the vite bundle
    const projectConfig = readJson(tree, 'test-app/project.json');
    expect(projectConfig.targets.build.dependsOn).toEqual([
      'lint',
      'compile',
      'test',
      'bundle',
    ]);

    // The vite production build (the deployable artifact) is inferred as the
    // `bundle` target via the @nx/vite plugin.
    const nxJson = readJson(tree, 'nx.json');
    const vitePlugin = nxJson.plugins.find(
      (p) => typeof p !== 'string' && p.plugin === '@nx/vite/plugin',
    );
    expect(vitePlugin.options.buildTargetName).toBe('bundle');
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
        tanstackRouter: false,
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
      expect(stylesContent).toContain('@import');
      expect(stylesContent).toContain('tailwindcss');
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

    it('should handle tailwind explicitly set to true', async () => {
      await tsReactWebsiteGenerator(tree, { ...options, tailwind: true });
      const packageJson = JSON.parse(tree.read('package.json').toString());
      const viteConfig = tree.read('test-app/vite.config.mts')?.toString();
      const stylesContent = tree.read('test-app/src/styles.css')?.toString();

      // Verify TailwindCSS is included
      expect(packageJson.dependencies).toHaveProperty('tailwindcss');
      expect(packageJson.devDependencies).toHaveProperty('@tailwindcss/vite');
      expect(viteConfig).toContain('tailwindcss()');
      expect(stylesContent).toContain('@import');
      expect(stylesContent).toContain('tailwindcss');
    });

    describe('terraform iac', () => {
      it('should generate terraform files for static website and snapshot them', async () => {
        await tsReactWebsiteGenerator(tree, {
          ...options,
          iac: 'terraform',
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
          iac: 'terraform',
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
        expect(projectConfig.targets['dev']).toBeDefined();
      });

      it('should not create CDK constructs when using terraform', async () => {
        await tsReactWebsiteGenerator(tree, {
          ...options,
          iac: 'terraform',
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

      it('should throw error for invalid iac', async () => {
        await expect(
          tsReactWebsiteGenerator(tree, {
            ...options,
            iac: 'InvalidProvider' as any,
          }),
        ).rejects.toThrow('Unsupported iac InvalidProvider');
      });

      it('should handle terraform with different directory structures', async () => {
        await tsReactWebsiteGenerator(tree, {
          ...options,
          name: 'nested-website',
          directory: 'apps/nested/path',
          iac: 'terraform',
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
          iac: 'terraform',
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

      it('should handle tailwind option correctly in terraform', async () => {
        await tsReactWebsiteGenerator(tree, {
          ...options,
          tailwind: false,
          iac: 'terraform',
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

      it('should handle tanstackRouter option correctly in terraform', async () => {
        await tsReactWebsiteGenerator(tree, {
          ...options,
          tanstackRouter: false,
          iac: 'terraform',
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
        iac: 'cdk',
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
        iac: 'terraform',
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

    it('should throw error for unknown iac', async () => {
      await expect(
        tsReactWebsiteGenerator(tree, {
          ...options,
          iac: 'UnknownProvider' as any,
        }),
      ).rejects.toThrow('Unsupported iac UnknownProvider');
    });

    it('should configure load:runtime-config target with custom directory for Terraform', async () => {
      await tsReactWebsiteGenerator(tree, {
        ...options,
        directory: 'custom-dir',
        iac: 'terraform',
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
        iac: 'cdk',
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

  it('should inherit iac from config when set to Inherit', async () => {
    // Set up config with CDK provider using utility methods
    await ensureAwsNxPluginConfig(tree);
    await updateAwsNxPluginConfig(tree, {
      iac: {
        provider: 'cdk',
      },
    });

    await tsReactWebsiteGenerator(tree, {
      ...options,
      iac: 'inherit',
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

  it('should place project in subDirectory when provided', async () => {
    await tsReactWebsiteGenerator(tree, {
      ...options,
      directory: 'packages',
      subDirectory: 'websites',
    });
    expect(tree.exists('packages/websites')).toBeTruthy();
    expect(tree.exists('packages/websites/src')).toBeTruthy();
    expect(tree.exists('packages/websites/src/main.tsx')).toBeTruthy();
  });

  describe('idempotency', () => {
    it('should preserve user edits to main.tsx, AppLayout and styles.css on re-run', async () => {
      await tsReactWebsiteGenerator(tree, options);

      const mainPath = 'test-app/src/main.tsx';
      const appLayoutPath = 'test-app/src/components/AppLayout/index.tsx';
      const stylesPath = 'test-app/src/styles.css';
      const rootRoutePath = 'test-app/src/routes/__root.tsx';
      const indexRoutePath = 'test-app/src/routes/index.tsx';
      const configPath = 'test-app/src/config.ts';

      const userMain = '// user edited main\nexport const MAIN = true;\n';
      const userAppLayout =
        '// user edited app layout\nexport const LAYOUT = true;\n';
      const userStyles = "@import 'tailwindcss';\n/* user edited styles */\n";
      const userRootRoute =
        '// user edited root route\nexport const ROOT = true;\n';
      const userIndexRoute =
        '// user edited index route\nexport const INDEX = true;\n';
      const userConfig = '// user edited config\nexport const CONFIG = true;\n';

      tree.write(mainPath, userMain);
      tree.write(appLayoutPath, userAppLayout);
      tree.write(stylesPath, userStyles);
      tree.write(rootRoutePath, userRootRoute);
      tree.write(indexRoutePath, userIndexRoute);
      tree.write(configPath, userConfig);

      await tsReactWebsiteGenerator(tree, options);

      expect(tree.read(mainPath, 'utf-8')).toBe(userMain);
      expect(tree.read(appLayoutPath, 'utf-8')).toBe(userAppLayout);
      expect(tree.read(stylesPath, 'utf-8')).toBe(userStyles);
      expect(tree.read(rootRoutePath, 'utf-8')).toBe(userRootRoute);
      expect(tree.read(indexRoutePath, 'utf-8')).toBe(userIndexRoute);
      expect(tree.read(configPath, 'utf-8')).toBe(userConfig);
    });
  });

  describe('infra=none idempotency', () => {
    it('should generate with infra=none then upgrade to infra=cloudfront-s3', async () => {
      await tsReactWebsiteGenerator(tree, { ...options, infra: 'none' });

      const projectJson = JSON.parse(
        tree.read('test-app/project.json', 'utf-8'),
      );
      expect(projectJson.targets['load:runtime-config']).toBeUndefined();
      expect(tree.exists('packages/common/constructs')).toBeFalsy();

      await tsReactWebsiteGenerator(tree, {
        ...options,
        infra: 'cloudfront-s3',
      });

      const updatedProjectJson = JSON.parse(
        tree.read('test-app/project.json', 'utf-8'),
      );
      expect(updatedProjectJson.targets['load:runtime-config']).toBeDefined();
      expect(tree.exists('packages/common/constructs')).toBeTruthy();
    });
  });
});

describe('react-website generator ux tests', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it.each(
    SUPPORTED_UX_PROVIDERS.map((p) => [p]),
  )('should add ux metadata (ux=%s)', async (ux) => {
    const options: TsReactWebsiteGeneratorSchema = {
      name: 'test-app',
      iac: 'cdk',
      ux: ux,
    };

    await tsReactWebsiteGenerator(tree, options);

    const projectConfig = JSON.parse(
      tree.read(`test-app/project.json`, 'utf-8'),
    );

    expect(projectConfig.metadata.ux).toEqual(ux);
  });

  describe('Cloudscape', () => {
    const options: TsReactWebsiteGeneratorSchema = {
      name: 'test-app',
      iac: 'cdk',
      ux: 'cloudscape',
    };

    it('should update package.json with required dependencies', async () => {
      await tsReactWebsiteGenerator(tree, options);
      snapshotTreeDir(tree, 'test-app/src');
      const packageJson = JSON.parse(tree.read('package.json').toString());
      // Check for website dependencies
      expect(packageJson.dependencies).toMatchObject({
        '@cloudscape-design/components': expect.any(String),
        '@cloudscape-design/board-components': expect.any(String),
      });
    });
  });

  describe('Shadcn', () => {
    const options: TsReactWebsiteGeneratorSchema = {
      name: 'test-app',
      iac: 'cdk',
      ux: 'shadcn',
    };

    it('should update package.json with required dependencies', async () => {
      await tsReactWebsiteGenerator(tree, options);
      snapshotTreeDir(tree, 'test-app/src');
      const packageJson = JSON.parse(tree.read('package.json').toString());
      expect(packageJson.dependencies).toMatchObject({
        'class-variance-authority': expect.any(String),
        clsx: expect.any(String),
        'tailwind-merge': expect.any(String),
        'tw-animate-css': expect.any(String),
        'lucide-react': expect.any(String),
        'radix-ui': expect.any(String),
      });
    });

    it('should scaffold the shared Shadcn package and components.json', async () => {
      await tsReactWebsiteGenerator(tree, options);

      expect(tree.exists('packages/common/shadcn/project.json')).toBeTruthy();
      expect(
        tree.exists('packages/common/shadcn/src/components/ui/button.tsx'),
      ).toBeTruthy();
      expect(tree.exists('components.json')).toBeTruthy();
    });

    it('should ensure pnpm-workspace.yaml ignores workspace root check when using Shadcn', async () => {
      await tsReactWebsiteGenerator(tree, options);

      const workspaceYaml = tree.read('pnpm-workspace.yaml', 'utf-8') ?? '';
      expect(workspaceYaml).toMatch(/ignoreWorkspaceRootCheck:\s*true/);
    });

    it('should preserve existing pnpm-workspace.yaml entries when enabling ignoreWorkspaceRootCheck', async () => {
      tree.write(
        'pnpm-workspace.yaml',
        "packages:\n  - packages/*\nallowBuilds:\n  '@swc/core': true\n",
      );

      await tsReactWebsiteGenerator(tree, options);

      const workspaceYaml = tree.read('pnpm-workspace.yaml', 'utf-8') ?? '';
      expect(workspaceYaml).toMatch(/ignoreWorkspaceRootCheck:\s*true/);
      expect(workspaceYaml).toMatch(/packages:/);
      expect(workspaceYaml).toMatch(/@swc\/core/);
    });

    it('should use shared Shadcn components when ux is Shadcn', async () => {
      await tsReactWebsiteGenerator(tree, options);
      expect(
        tree.read('test-app/src/components/AppLayout/index.tsx')?.toString(),
      ).toContain('common-shadcn');
    });
  });
});
