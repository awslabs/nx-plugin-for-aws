/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import migration from './migration';

const LIB_CONFIG = 'packages/lib/vitest.config.mts';
const WEBSITE_CONFIG = 'packages/website/vite.config.mts';

/**
 * A library's `vitest.config.mts` as an older release generated it. Hardcoded
 * rather than produced by the generator: a migration has to keep applying to the
 * shape that shipped, however far the generator's output moves afterwards.
 */
const OLD_LIB_CONFIG = `import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/lib',
  test: {
    passWithNoTests: true,
    name: '@proj/lib',
    watch: false,
    globals: true,
    environment: 'jsdom',
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
`;

/** A website's `vite.config.mts` as an older release generated it. */
const OLD_WEBSITE_CONFIG = `import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/website',
  plugins: [
    tanstackRouter({
      routesDirectory: resolve(__dirname, 'src/routes'),
      generatedRouteTree: resolve(__dirname, 'src/routeTree.gen.ts'),
    }),
    react(),
    tailwindcss(),
  ],
  build: {
    outDir: '../../dist/packages/website/bundle',
  },
}));
`;

const read = (tree: Tree, path: string): string =>
  tree.read(path, 'utf-8') ?? '';

/** Register a project and write the given config into it. */
const givenProject = (tree: Tree, name: string, config: string): void => {
  const root = `packages/${name}`;
  addProjectConfiguration(tree, `@proj/${name}`, {
    root,
    sourceRoot: `${root}/src`,
  });
  const configFile =
    name === 'website' ? 'vite.config.mts' : 'vitest.config.mts';
  tree.write(`${root}/${configFile}`, config);
};

const givenOldWorkspace = (tree: Tree): void => {
  givenProject(tree, 'lib', OLD_LIB_CONFIG);
  givenProject(tree, 'website', OLD_WEBSITE_CONFIG);
};

describe('vite-config-import-meta-dirname migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should rewrite the config root an older release generated', async () => {
    givenOldWorkspace(tree);

    await migration(tree);

    expect(read(tree, LIB_CONFIG)).toContain('root: import.meta.dirname');
    expect(read(tree, LIB_CONFIG)).not.toContain('__dirname,');
  });

  it('should rewrite the router paths the website resolves', async () => {
    givenOldWorkspace(tree);

    await migration(tree);

    const config = read(tree, WEBSITE_CONFIG);
    expect(config).toContain(`resolve(import.meta.dirname, 'src/routes')`);
    expect(config).toContain(
      `resolve(import.meta.dirname, 'src/routeTree.gen.ts')`,
    );
    expect(config).not.toContain('__dirname');
  });

  it('should leave a root nested inside another option alone', async () => {
    givenProject(
      tree,
      'lib',
      OLD_LIB_CONFIG.replace(
        `    reporters: ['default'],`,
        `    reporters: ['default'],\n    alias: { root: __dirname },`,
      ),
    );

    await migration(tree);

    const config = read(tree, LIB_CONFIG);
    // Only the config object's own `root` is the one Vite reads.
    expect(config).toContain('root: import.meta.dirname');
    expect(config).toContain('alias: { root: __dirname }');
  });

  it('should leave a __dirname the user resolves elsewhere alone', async () => {
    givenProject(
      tree,
      'website',
      OLD_WEBSITE_CONFIG.replace(
        `  build: {`,
        `  test: { setupFiles: resolve(__dirname, 'test/setup.ts') },\n  build: {`,
      ),
    );

    await migration(tree);

    const config = read(tree, WEBSITE_CONFIG);
    expect(config).toContain(`resolve(__dirname, 'test/setup.ts')`);
    expect(config).toContain(`resolve(import.meta.dirname, 'src/routes')`);
  });

  it('should leave a router path the user repointed alone', async () => {
    givenProject(
      tree,
      'website',
      OLD_WEBSITE_CONFIG.replace(`'src/routes'`, `'src/my-routes'`),
    );

    await migration(tree);

    const config = read(tree, WEBSITE_CONFIG);
    expect(config).toContain(`resolve(__dirname, 'src/my-routes')`);
    // The option they left alone still gets the fix.
    expect(config).toContain(
      `resolve(import.meta.dirname, 'src/routeTree.gen.ts')`,
    );
  });

  it('should leave a config without the generated shape alone', async () => {
    givenProject(
      tree,
      'lib',
      OLD_LIB_CONFIG.replace('root: __dirname', 'root: process.cwd()'),
    );

    await migration(tree);

    expect(read(tree, LIB_CONFIG)).toContain('root: process.cwd()');
    expect(read(tree, LIB_CONFIG)).not.toContain('import.meta.dirname');
  });

  it('should be idempotent', async () => {
    givenOldWorkspace(tree);

    await migration(tree);
    const afterFirst = [LIB_CONFIG, WEBSITE_CONFIG].map((path) =>
      read(tree, path),
    );
    await migration(tree);

    expect(
      [LIB_CONFIG, WEBSITE_CONFIG].map((path) => read(tree, path)),
    ).toEqual(afterFirst);
  });
});
