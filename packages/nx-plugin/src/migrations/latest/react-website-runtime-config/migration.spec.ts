/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { REACT_WEBSITE_APP_GENERATOR_INFO } from '../../../ts/react-website/app/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const WEBSITE_ROOT = 'packages/my-website';
const SRC = `${WEBSITE_ROOT}/src`;
const MAIN_TSX = `${SRC}/main.tsx`;
const PROVIDER = `${SRC}/components/RuntimeConfig/index.tsx`;
const HOOK = `${SRC}/hooks/useRuntimeConfig.tsx`;

/**
 * A tanstack-router website's `main.tsx` as the release before this change
 * vended it, hardcoded rather than produced by running the generator: a
 * migration has to keep applying to the shape that shipped.
 */
const MAIN_TSX_BEFORE = `import React from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import './styles.css';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type RouterProviderContext = {};

const router = createRouter({
  routeTree,
  context: {},
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const App = () => {
  return <RouterProvider router={router} context={{}} />;
};

const root = document.getElementById('root');
root &&
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
`;

const addWebsite = (
  tree: Tree,
  options?: { name?: string; root?: string; generator?: string },
) => {
  const root = options?.root ?? WEBSITE_ROOT;
  addProjectConfiguration(tree, options?.name ?? '@proj/my-website', {
    root,
    sourceRoot: `${root}/src`,
    metadata: {
      generator: options?.generator ?? REACT_WEBSITE_APP_GENERATOR_INFO.id,
      ux: 'shadcn',
      framework: 'react',
    } as any,
  });
  tree.write(`${root}/src/main.tsx`, MAIN_TSX_BEFORE);
  tree.write(
    `${root}/src/components/spinner.tsx`,
    `export const Spinner = () => null;\n`,
  );
};

describe('react-website-runtime-config migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should add the provider and hook to a website that lacks them', async () => {
    addWebsite(tree);

    const result = await migration(tree);

    expect(tree.exists(PROVIDER)).toBe(true);
    expect(tree.exists(HOOK)).toBe(true);
    expect(result.nextSteps).toEqual([]);
  });

  it('should wire the provider and hook into main.tsx', async () => {
    addWebsite(tree);

    await migration(tree);

    const main = tree.read(MAIN_TSX, 'utf-8') ?? '';
    expect(main).toContain(
      "import RuntimeConfigProvider from './components/RuntimeConfig'",
    );
    expect(main).toContain(
      "import { useRuntimeConfig } from './hooks/useRuntimeConfig'",
    );
    expect(main).toContain('<RuntimeConfigProvider>');
    expect(main).toContain('const runtimeConfig = useRuntimeConfig();');
    expect(main).toContain(
      'runtimeConfig?: ReturnType<typeof useRuntimeConfig>',
    );
  });

  it('should leave a website that already has them untouched', async () => {
    addWebsite(tree);
    tree.write(PROVIDER, '// my own provider');
    tree.write(HOOK, '// my own hook');
    const mainBefore = tree.read(MAIN_TSX, 'utf-8');

    await migration(tree);

    expect(tree.read(PROVIDER, 'utf-8')).toContain('// my own provider');
    expect(tree.read(PROVIDER, 'utf-8')).not.toContain('RuntimeConfigProvider');
    expect(tree.read(HOOK, 'utf-8')).toContain('// my own hook');
    expect(tree.read(MAIN_TSX, 'utf-8')).toBe(mainBefore);
  });

  it('should skip projects which are not react websites', async () => {
    addWebsite(tree, { generator: 'ts#project' });

    await migration(tree);

    expect(tree.exists(PROVIDER)).toBe(false);
  });

  it('should report a website with no main.tsx rather than failing', async () => {
    addWebsite(tree);
    tree.delete(MAIN_TSX);

    const result = await migration(tree);

    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps?.[0]).toContain('@proj/my-website');
    expect(result.nextSteps?.[0]).toContain('main.tsx');
  });

  it('should be idempotent', async () => {
    addWebsite(tree);

    await migration(tree);
    const afterFirst = {
      main: tree.read(MAIN_TSX, 'utf-8'),
      provider: tree.read(PROVIDER, 'utf-8'),
      hook: tree.read(HOOK, 'utf-8'),
    };

    await migration(tree);

    expect(tree.read(MAIN_TSX, 'utf-8')).toBe(afterFirst.main);
    expect(tree.read(PROVIDER, 'utf-8')).toBe(afterFirst.provider);
    expect(tree.read(HOOK, 'utf-8')).toBe(afterFirst.hook);
  });

  it('should preserve user edits to the provider across a re-run', async () => {
    addWebsite(tree);
    await migration(tree);

    tree.write(PROVIDER, '// user customised provider');
    await migration(tree);

    expect(tree.read(PROVIDER, 'utf-8')).toContain(
      '// user customised provider',
    );
    expect(tree.read(PROVIDER, 'utf-8')).not.toContain('RuntimeConfigProvider');
  });
});
