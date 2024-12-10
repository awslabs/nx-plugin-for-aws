import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree } from '@nx/devkit';
import { Linter } from '@nx/eslint';
import { appGenerator } from './generator';
import { AppGeneratorSchema } from './schema';

describe('cloudscape-website generator', () => {
  let tree: Tree;
  const options: AppGeneratorSchema = {
    name: 'test-app',
    style: 'css',
    linter: Linter.EsLint,
    unitTestRunner: 'vitest',
    bundler: 'vite',
  };

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('should generate base files and structure', async () => {
    await appGenerator(tree, options);
    
    // Check main application files
    expect(tree.exists('test-app/src/main.tsx')).toBeTruthy();
    expect(tree.exists('test-app/src/config.ts')).toBeTruthy();
    expect(tree.exists('test-app/src/layouts/App/index.tsx')).toBeTruthy();
    expect(tree.exists('test-app/src/layouts/Routes/index.tsx')).toBeTruthy();
    expect(tree.exists('test-app/src/pages/Home/index.tsx')).toBeTruthy();

    // Snapshot the main application files
    expect(tree.read('test-app/src/main.tsx')?.toString()).toMatchSnapshot('main.tsx');
    expect(tree.read('test-app/src/config.ts')?.toString()).toMatchSnapshot('config.ts');
    expect(tree.read('test-app/src/layouts/App/index.tsx')?.toString()).toMatchSnapshot('app-layout.tsx');
  });

  it('should configure vite correctly', async () => {
    await appGenerator(tree, options);
    
    const viteConfig = tree.read('test-app/vite.config.ts')?.toString();
    expect(viteConfig).toBeDefined();
    expect(viteConfig).toMatchSnapshot('vite.config.ts');
  });

  it('should generate shared constructs', async () => {
    await appGenerator(tree, options);
    
    // Check shared constructs files
    expect(tree.exists('packages/common/constructs/src/test-app/index.ts')).toBeTruthy();
    expect(tree.exists('packages/common/constructs/src/test-app/static-website.ts')).toBeTruthy();
    expect(tree.exists('packages/common/constructs/src/test-app/cloudfront-web-acl.ts')).toBeTruthy();

    // Snapshot the shared constructs files
    expect(tree.read('packages/common/constructs/src/test-app/index.ts')?.toString()).toMatchSnapshot('common/constructs-index.ts');
    expect(tree.read('packages/common/constructs/src/test-app/static-website.ts')?.toString()).toMatchSnapshot('static-website.ts');
  });

  it('should update package.json with required dependencies', async () => {
    await appGenerator(tree, options);
    
    const packageJson = JSON.parse(tree.read('package.json')!.toString());
    
    // Check for Cloudscape dependencies
    expect(packageJson.dependencies).toMatchObject({
      '@aws-northstar/ui': expect.any(String),
      '@cloudscape-design/components': expect.any(String),
      '@cloudscape-design/board-components': expect.any(String),
      'react-router-dom': expect.any(String),
    });

    // Check for AWS CDK dependencies
    expect(packageJson.dependencies).toMatchObject({
      'constructs': expect.any(String),
      '@aws/pdk': expect.any(String),
      'cdk-nag': expect.any(String),
      'aws-cdk-lib': expect.any(String),
    });
  });

  it('should configure TypeScript correctly', async () => {
    await appGenerator(tree, options);
    
    const tsConfig = JSON.parse(tree.read('test-app/tsconfig.json')!.toString());
    expect(tsConfig.compilerOptions.moduleResolution).toBe('Bundler');
    expect(tsConfig).toMatchSnapshot('tsconfig.json');
  });

  it('should handle custom directory option', async () => {
    await appGenerator(tree, {
      ...options,
      directory: 'custom-dir',
    });
    
    expect(tree.exists('custom-dir/test-app/src/main.tsx')).toBeTruthy();
    expect(tree.read('custom-dir/test-app/src/main.tsx')?.toString()).toMatchSnapshot('custom-dir-main.tsx');
  });

  it('should handle npm scope prefix correctly', async () => {
    // Set up package.json with a scope
    tree.write('package.json', JSON.stringify({
      name: '@test-scope/root',
      version: '0.0.0',
    }));

    await appGenerator(tree, options);
    
    const packageJson = JSON.parse(tree.read('package.json')!.toString());
    expect(packageJson.dependencies).toMatchSnapshot('scoped-dependencies');
  });
});
