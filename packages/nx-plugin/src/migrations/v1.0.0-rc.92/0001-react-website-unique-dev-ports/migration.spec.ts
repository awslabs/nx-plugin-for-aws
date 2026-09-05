/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  readProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import { REACT_WEBSITE_APP_GENERATOR_INFO } from '../../../ts/react-website/app/generator.js';
import { COGNITO_AUTH_GENERATOR_INFO } from '../../../ts/react-website/cognito-auth/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const CDK_IDENTITY_FILE =
  'packages/common/constructs/src/core/user-identity.ts';
const TERRAFORM_IDENTITY_FILE =
  'packages/common/terraform/src/core/user-identity/identity/identity.tf';

// The shape @nx/react + this generator's own GritQL passes produce, before this
// change: every website hardcoded the same two ports regardless of how many
// other websites already claimed them.
const preFixViteConfig = (
  name: string,
) => `import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
/// <reference types='vitest' />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/packages/${name}',
  server: {
    port: 4200,
    host: 'localhost',
  },
  preview: {
    port: 4300,
    host: 'localhost',
  },
  plugins: [
    tanstackRouter({
      routesDirectory: resolve(import.meta.dirname, 'src/routes'),
      generatedRouteTree: resolve(import.meta.dirname, 'src/routeTree.gen.ts'),
    }),
    react(),
    tailwindcss(),
  ],
  build: {
    outDir: '../../dist/packages/${name}/bundle',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  test: {
    passWithNoTests: true,
    name: '@proj/${name}',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
  resolve: { tsconfigPaths: true, dedupe: ['react', 'react-dom'] },
  define: { global: {} },
}));
`;

const PRE_FIX_CDK_IDENTITY = `const WEB_CLIENT_ID = 'WebClient';

/** Local dev server origins permitted to complete the sign-in redirect */
const LOCAL_CALLBACK_URLS = ['http://localhost:4200', 'http://localhost:4300'];
`;

const PRE_FIX_TERRAFORM_IDENTITY = `locals {
  # Local dev server origins permitted to complete the sign-in redirect
  local_callback_urls = [
    "http://localhost:4200",
    "http://localhost:4300"
  ]
}
`;

const addWebsiteProject = (
  tree: Tree,
  name: string,
  options: {
    viteConfig?: string;
    withAuth?: 'cdk' | 'terraform';
  } = {},
) => {
  const root = `packages/${name}`;
  tree.write(
    `${root}/vite.config.mts`,
    options.viteConfig ?? preFixViteConfig(name),
  );
  addProjectConfiguration(tree, name, {
    root,
    sourceRoot: `${root}/src`,
    metadata: {
      generator: REACT_WEBSITE_APP_GENERATOR_INFO.id,
      ux: 'shadcn',
      framework: 'react',
      infra: 'cloudfront-s3',
      tailwind: true,
      tanstackRouter: true,
      iac: options.withAuth,
      ...(options.withAuth && {
        components: [
          {
            generator: COGNITO_AUTH_GENERATOR_INFO.id,
            path: 'src/components/CognitoAuth',
            iac: options.withAuth,
          },
        ],
      }),
    } as Record<string, unknown>,
    targets: {},
  });
};

describe('react-website-unique-dev-ports migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should be a no-op when the workspace has no react-website projects', async () => {
    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
  });

  it("should assign a lone website's dev-server and preview ports", async () => {
    addWebsiteProject(tree, 'website-one');

    const result = await migration(tree);

    const project = readProjectConfiguration(tree, 'website-one');
    expect((project.metadata as any).ports).toEqual([4200]);
    const viteConfig = tree.read(
      'packages/website-one/vite.config.mts',
      'utf-8',
    );
    expect(viteConfig).toContain('port: 4200');
    expect(viteConfig).toContain('port: 4300');
    expect(result.nextSteps).toEqual([]);
  });

  it('should assign each website a distinct dev-server and preview port', async () => {
    // Both start out hardcoded to the exact same two ports - the bug this fixes.
    addWebsiteProject(tree, 'website-a');
    addWebsiteProject(tree, 'website-b');

    const result = await migration(tree);

    expect(
      (readProjectConfiguration(tree, 'website-a').metadata as any).ports,
    ).toEqual([4200]);
    expect(
      (readProjectConfiguration(tree, 'website-b').metadata as any).ports,
    ).toEqual([4201]);

    const viteConfigA = tree.read(
      'packages/website-a/vite.config.mts',
      'utf-8',
    );
    expect(viteConfigA).toContain('port: 4200');
    expect(viteConfigA).toContain('port: 4300');
    const viteConfigB = tree.read(
      'packages/website-b/vite.config.mts',
      'utf-8',
    );
    expect(viteConfigB).toContain('port: 4201');
    expect(viteConfigB).toContain('port: 4301');
    expect(result.nextSteps).toEqual([]);
  });

  it("should allow-list a website's assigned ports on the shared CDK construct", async () => {
    tree.write(CDK_IDENTITY_FILE, PRE_FIX_CDK_IDENTITY);
    // First site keeps the pre-fix defaults; the second (auth-enabled) site is
    // the one whose newly-assigned ports need adding to the callback list.
    addWebsiteProject(tree, 'website-a');
    addWebsiteProject(tree, 'website-b', { withAuth: 'cdk' });

    const result = await migration(tree);

    const identity = tree.read(CDK_IDENTITY_FILE, 'utf-8');
    expect(identity).toContain("'http://localhost:4201'");
    expect(identity).toContain("'http://localhost:4301'");
    expect(result.nextSteps).toEqual([]);
  });

  it("should allow-list a website's assigned ports on the shared Terraform module", async () => {
    tree.write(TERRAFORM_IDENTITY_FILE, PRE_FIX_TERRAFORM_IDENTITY);
    addWebsiteProject(tree, 'website-a');
    addWebsiteProject(tree, 'website-b', { withAuth: 'terraform' });

    const result = await migration(tree);

    const identity = tree.read(TERRAFORM_IDENTITY_FILE, 'utf-8');
    expect(identity).toContain('"http://localhost:4201"');
    expect(identity).toContain('"http://localhost:4301"');
    expect(result.nextSteps).toEqual([]);
  });

  it("should skip and report a vite.config.mts that has diverged, while still reserving the project's ports", async () => {
    addWebsiteProject(tree, 'website-one', {
      viteConfig: `import { defineConfig } from 'vite';\nexport default defineConfig({});\n`,
    });

    const result = await migration(tree);

    // Nothing to match, so the file is left exactly as it was.
    expect(tree.read('packages/website-one/vite.config.mts', 'utf-8')).toBe(
      `import { defineConfig } from 'vite';\nexport default defineConfig({});\n`,
    );
    // Ports are still reserved in metadata so a second website doesn't collide.
    expect(
      (readProjectConfiguration(tree, 'website-one').metadata as any).ports,
    ).toEqual([4200]);
    expect(
      result.nextSteps.some(
        (s) => s.includes('vite.config.mts') && s.includes('server'),
      ),
    ).toBeTruthy();
    expect(
      result.nextSteps.some(
        (s) => s.includes('vite.config.mts') && s.includes('preview'),
      ),
    ).toBeTruthy();
  });

  it('should skip and report a shared identity construct that has diverged', async () => {
    tree.write(
      CDK_IDENTITY_FILE,
      "const WEB_CLIENT_ID = 'WebClient';\n// customised beyond recognition\n",
    );
    addWebsiteProject(tree, 'website-one', { withAuth: 'cdk' });

    const result = await migration(tree);

    expect(
      result.nextSteps.some(
        (s) => s.includes('diverged') && s.includes('4200'),
      ),
    ).toBeTruthy();
  });

  it('should be idempotent', async () => {
    tree.write(CDK_IDENTITY_FILE, PRE_FIX_CDK_IDENTITY);
    addWebsiteProject(tree, 'website-a');
    addWebsiteProject(tree, 'website-b', { withAuth: 'cdk' });

    await migration(tree);
    const afterFirstRun = {
      a: readProjectConfiguration(tree, 'website-a'),
      b: readProjectConfiguration(tree, 'website-b'),
      viteA: tree.read('packages/website-a/vite.config.mts', 'utf-8'),
      viteB: tree.read('packages/website-b/vite.config.mts', 'utf-8'),
      identity: tree.read(CDK_IDENTITY_FILE, 'utf-8'),
    };

    const result = await migration(tree);

    expect(readProjectConfiguration(tree, 'website-a')).toEqual(
      afterFirstRun.a,
    );
    expect(readProjectConfiguration(tree, 'website-b')).toEqual(
      afterFirstRun.b,
    );
    expect(tree.read('packages/website-a/vite.config.mts', 'utf-8')).toEqual(
      afterFirstRun.viteA,
    );
    expect(tree.read('packages/website-b/vite.config.mts', 'utf-8')).toEqual(
      afterFirstRun.viteB,
    );
    expect(tree.read(CDK_IDENTITY_FILE, 'utf-8')).toEqual(
      afterFirstRun.identity,
    );
    // The callback URLs are already there, so the second run has nothing new
    // to add and nothing diverged to report.
    expect(result.nextSteps).toEqual([]);
  });
});
