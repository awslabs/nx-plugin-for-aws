/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { REACT_WEBSITE_APP_GENERATOR_INFO } from '../../../ts/react-website/app/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const VITE_CONFIG = 'packages/website/vite.config.mts';

const READY_SIGNAL_IMPORT =
  "import { nxReadySignal } from '@nx/vite/plugins/nx-ready-signal.plugin';";

/** The `vite.config.mts` up to its plugins, as @aws/nx-plugin 1.3.9 vends it. */
const HEAD = `/// <reference types='vitest' />
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';`;

const CONFIG_START = `
export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/packages/website',
  server: {
    port: 4200,
    host: 'localhost',
  },
  plugins: [
    tanstackRouter({
      routesDirectory: resolve(import.meta.dirname, 'src/routes'),
      generatedRouteTree: resolve(import.meta.dirname, 'src/routeTree.gen.ts'),
    }),
`;

const CONFIG_END = `  ],
  build: {
    outDir: '../../dist/packages/website/bundle',
    emptyOutDir: true,
  },
  resolve: { tsconfigPaths: true, dedupe: ['react', 'react-dom'] },
  define: { global: {} },
}));
`;

/** A website config without the ready-signal plugin (pre-Nx 24). */
const WITHOUT_SIGNAL = `${HEAD}
${CONFIG_START}    react(),
    tailwindcss(),
${CONFIG_END}`;

/** What Nx 24's own migration leaves: the plugin on the line of the last one. */
const NX_MIGRATED = `${HEAD}
${READY_SIGNAL_IMPORT}
${CONFIG_START}    react(),
    tailwindcss(), nxReadySignal(),
${CONFIG_END}`;

/** The Nx-migrated config once formatted. */
const NX_MIGRATED_FORMATTED = `${HEAD}
${READY_SIGNAL_IMPORT}
${CONFIG_START}    react(),
    tailwindcss(),
    nxReadySignal(),
${CONFIG_END}`;

/** The shape a new react website gets: the plugin straight after react(). */
const GENERATED = `${HEAD}
${READY_SIGNAL_IMPORT}
${CONFIG_START}    react(),
    nxReadySignal(),
    tailwindcss(),
${CONFIG_END}`;

/** Add a project at `packages/<name>`, tagged as a react website by default. */
const addWebsite = (
  tree: Tree,
  name: string,
  viteConfig: string,
  generator = REACT_WEBSITE_APP_GENERATOR_INFO.id,
) => {
  addProjectConfiguration(tree, name, {
    root: `packages/${name}`,
    projectType: 'application',
    metadata: { generator } as Record<string, unknown>,
  });
  tree.write(`packages/${name}/vite.config.mts`, viteConfig);
};

/** Nx 24's `@nx/vite:update-24-0-0-add-ready-signal-plugin` migration. */
const nxAddReadySignalPlugin = (): ((tree: Tree) => Promise<unknown>) => {
  const require = createRequire(import.meta.url);
  const viteRoot = path.dirname(require.resolve('@nx/vite/package.json'));
  return require(
    path.join(
      viteRoot,
      'dist/src/migrations/update-24-0-0/add-ready-signal-plugin.js',
    ),
  ).default;
};

describe('vite-config-nx-ready-signal migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('adds nxReadySignal() after react(), formatted, when absent', async () => {
    addWebsite(tree, 'website', WITHOUT_SIGNAL);

    const { nextSteps } = await migration(tree);

    expect(tree.read(VITE_CONFIG, 'utf-8')).toBe(GENERATED);
    expect(nextSteps).toEqual([]);
  });

  it('formats a config where Nx has already added nxReadySignal() inline', async () => {
    addWebsite(tree, 'website', NX_MIGRATED);

    await migration(tree);

    expect(tree.read(VITE_CONFIG, 'utf-8')).toBe(NX_MIGRATED_FORMATTED);
  });

  it('leaves an already formatted config unchanged', async () => {
    addWebsite(tree, 'website', GENERATED);

    const { nextSteps } = await migration(tree);

    expect(tree.read(VITE_CONFIG, 'utf-8')).toBe(GENERATED);
    expect(nextSteps).toEqual([]);
  });

  it('is a no-op when run again', async () => {
    addWebsite(tree, 'website', WITHOUT_SIGNAL);

    await migration(tree);
    await migration(tree);

    expect(tree.read(VITE_CONFIG, 'utf-8')).toBe(GENERATED);
  });

  it("Nx's own migration alone adds nxReadySignal() inline", async () => {
    addWebsite(tree, 'website', WITHOUT_SIGNAL);

    await nxAddReadySignalPlugin()(tree);

    expect(tree.read(VITE_CONFIG, 'utf-8')).toBe(NX_MIGRATED);
  });

  it("leaves Nx's own migration nothing to change", async () => {
    addWebsite(tree, 'website', WITHOUT_SIGNAL);

    await migration(tree);
    await nxAddReadySignalPlugin()(tree);

    expect(tree.read(VITE_CONFIG, 'utf-8')).toBe(GENERATED);
  });

  it('leaves a config whose plugins have no react() untouched', async () => {
    const userConfig = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { myReact } from './my-react';

export default defineConfig(() => ({
  plugins: [myReact(react)],
}));
`;
    addWebsite(tree, 'website', userConfig);

    const { nextSteps } = await migration(tree);

    expect(tree.read(VITE_CONFIG, 'utf-8')).toBe(userConfig);
    expect(nextSteps).toEqual([expect.stringContaining(VITE_CONFIG)]);
  });

  it('leaves a config that wraps react() in another plugin untouched', async () => {
    const userConfig = WITHOUT_SIGNAL.replace(
      '    react(),\n',
      '    inspect(react()),\n',
    );
    addWebsite(tree, 'website', userConfig);

    const { nextSteps } = await migration(tree);

    expect(tree.read(VITE_CONFIG, 'utf-8')).toBe(userConfig);
    expect(nextSteps).toEqual([expect.stringContaining(VITE_CONFIG)]);
  });

  it('leaves a config that imports react from elsewhere untouched', async () => {
    const userConfig = WITHOUT_SIGNAL.replace(
      "import react from '@vitejs/plugin-react';",
      "import react from '@vitejs/plugin-react-swc';",
    );
    addWebsite(tree, 'website', userConfig);

    const { nextSteps } = await migration(tree);

    expect(tree.read(VITE_CONFIG, 'utf-8')).toBe(userConfig);
    expect(nextSteps).toEqual([expect.stringContaining(VITE_CONFIG)]);
  });

  it('leaves projects other generators created untouched', async () => {
    addWebsite(tree, 'website', NX_MIGRATED, 'ts#project');

    const { nextSteps } = await migration(tree);

    expect(tree.read(VITE_CONFIG, 'utf-8')).toBe(NX_MIGRATED);
    expect(nextSteps).toEqual([]);
  });

  it('skips a website without a vite.config.mts', async () => {
    addWebsite(tree, 'website', WITHOUT_SIGNAL);
    tree.delete(VITE_CONFIG);

    const { nextSteps } = await migration(tree);

    expect(tree.exists(VITE_CONFIG)).toBe(false);
    expect(nextSteps).toEqual([]);
  });
});
