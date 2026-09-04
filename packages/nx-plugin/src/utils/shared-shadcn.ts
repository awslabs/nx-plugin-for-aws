/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
  updateJson,
} from '@nx/devkit';
import tsProjectGenerator from '../ts/lib/generator.js';
import {
  configureTsProject,
  TS_PROJECT_DEPENDENCIES,
} from '../ts/lib/ts-project-utils.js';
import { VITEST_DEPENDENCIES } from '../ts/lib/vitest.js';
import {
  type DependencyDeclaration,
  declaredNames,
  forDependencies,
  type MustDeclare,
} from './declared-dependencies.js';
import {
  addDependenciesToPackageJson,
  getLocalDependencySpecifier,
} from './dependencies.js';
import { formatFilesInSubtree } from './format.js';
import { esmVars } from './module-format.js';
import { getNpmScopePrefix } from './npm-scope.js';
import {
  PACKAGES_DIR,
  SHARED_SHADCN_DIR,
  SHARED_SHADCN_NAME,
} from './shared-constructs-constants.js';
import { type ITsDepVersion, withVersions } from './versions.js';

/** Dependencies a caller must declare to use the shared shadcn project. */
export const SHADCN_DEPENDENCIES = [
  { name: 'react' },
  { name: 'react-dom' },
  { name: 'class-variance-authority' },
  { name: 'clsx' },
  { name: 'tailwind-merge' },
  { name: 'lucide-react' },
  { name: 'tw-animate-css' },
  { name: 'radix-ui' },
  ...VITEST_DEPENDENCIES,
  ...TS_PROJECT_DEPENDENCIES,
] as const satisfies readonly { name: ITsDepVersion; dev?: boolean }[];

/** The shared shadcn package's fully-qualified npm name for this workspace. */
export const getSharedShadcnFullyQualifiedName = (tree: Tree): string =>
  `${getNpmScopePrefix(tree)}${SHARED_SHADCN_NAME}`;

/**
 * Declares a `workspace:*` dependency on the shared shadcn package in a
 * consumer's own package.json, so it resolves through the shared package's
 * `exports` map (real package resolution) rather than a tsconfig `paths`
 * alias - see `sharedShadcnGenerator` for why.
 */
export const addSharedShadcnDependency = (
  tree: Tree,
  consumerDir: string,
): void => {
  addDependenciesToPackageJson(
    tree,
    {
      [getSharedShadcnFullyQualifiedName(tree)]:
        getLocalDependencySpecifier(tree),
    },
    {},
    joinPathFragments(consumerDir, 'package.json'),
  );
};

export async function sharedShadcnGenerator<
  const D extends DependencyDeclaration,
>(tree: Tree, declaration: D & MustDeclare<typeof SHADCN_DEPENDENCIES, D>) {
  const fullyQualifiedName = getSharedShadcnFullyQualifiedName(tree);
  const libraryRoot = joinPathFragments(PACKAGES_DIR, SHARED_SHADCN_DIR);
  const shadcnSrcRoot = joinPathFragments(libraryRoot, 'src');

  if (!tree.exists(joinPathFragments(libraryRoot, 'project.json'))) {
    await tsProjectGenerator(tree, {
      name: SHARED_SHADCN_NAME,
      directory: PACKAGES_DIR,
      subDirectory: SHARED_SHADCN_DIR,
    });

    tree.delete(shadcnSrcRoot);

    generateFiles(
      tree,
      joinPathFragments(import.meta.dirname, 'files', SHARED_SHADCN_DIR, 'src'),
      shadcnSrcRoot,
      esmVars(tree),
      {
        overwriteStrategy: OverwriteStrategy.KeepExisting,
      },
    );

    generateFiles(
      tree,
      joinPathFragments(
        import.meta.dirname,
        'files',
        SHARED_SHADCN_DIR,
        'readme',
      ),
      libraryRoot,
      {
        fullyQualifiedName,
      },
      {
        overwriteStrategy: OverwriteStrategy.Overwrite,
      },
    );

    await configureTsProject(
      tree,
      {
        dir: libraryRoot,
        fullyQualifiedName,
      },
      forDependencies<typeof SHADCN_DEPENDENCIES>(declaration),
    );

    updateJson(
      tree,
      joinPathFragments(libraryRoot, 'tsconfig.lib.json'),
      (json) => ({
        ...json,
        compilerOptions: {
          ...json.compilerOptions,
          jsx: 'react-jsx',
          module: 'preserve',
          moduleResolution: 'bundler',
          lib: Array.from(
            new Set([...(json.compilerOptions?.lib ?? []), 'DOM']),
          ),
        },
        include: Array.from(new Set([...(json.include ?? []), 'src/**/*.tsx'])),
      }),
    );

    addDependenciesToPackageJson(
      tree,
      withVersions(
        forDependencies<typeof SHADCN_DEPENDENCIES>(declaration),
        declaredNames(SHADCN_DEPENDENCIES),
      ),
      {},
      joinPathFragments(libraryRoot, 'package.json'),
    );

    // shadcn 4.x's CLI resolves the `components.json` alias via `imports`/
    // `exports` (Node's package resolution), not a tsconfig `paths` alias.
    // `imports` covers this package's own internal component-to-component
    // references (aliased in components.json below); `exports` covers every
    // other consumer.
    updateJson(
      tree,
      joinPathFragments(libraryRoot, 'package.json'),
      (packageJson) => ({
        ...packageJson,
        imports: {
          '#components/*': './src/components/*.tsx',
          '#lib/*': './src/lib/*.ts',
          '#hooks/*': './src/hooks/*.ts',
        },
        exports: {
          '.': './src/index.ts',
          './styles/*': './src/styles/*',
          './components/*': './src/components/*.tsx',
          './lib/*': './src/lib/*.ts',
          './hooks/*': './src/hooks/*.ts',
        },
      }),
    );
  }

  // components.json lives in the package so `shadcn add` runs there and
  // installs component dependencies into the package's own manifest.
  if (!tree.exists(joinPathFragments(libraryRoot, 'components.json'))) {
    generateFiles(
      tree,
      joinPathFragments(import.meta.dirname, 'files', 'shadcn'),
      libraryRoot,
      {},
      {
        overwriteStrategy: OverwriteStrategy.KeepExisting,
      },
    );
  }

  await formatFilesInSubtree(tree);
}
