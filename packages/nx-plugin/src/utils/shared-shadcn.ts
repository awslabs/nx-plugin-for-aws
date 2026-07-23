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
import tsProjectGenerator from '../ts/lib/generator';
import { configureTsProject } from '../ts/lib/ts-project-utils';
import { addDependenciesToPackageJson } from './dependencies';
import { formatFilesInSubtree } from './format';
import { esmVars } from './module-format';
import { getNpmScopePrefix } from './npm-scope';
import {
  PACKAGES_DIR,
  SHARED_SHADCN_DIR,
  SHARED_SHADCN_NAME,
} from './shared-constructs-constants';
import { type ITsDepVersion, withVersions } from './versions';

const SHADCN_DEPS = [
  'react',
  'react-dom',
  'class-variance-authority',
  'clsx',
  'tailwind-merge',
  'lucide-react',
  'tw-animate-css',
  'radix-ui',
] as const satisfies ITsDepVersion[];

export async function sharedShadcnGenerator(tree: Tree) {
  const npmScopePrefix = getNpmScopePrefix(tree);
  const scopeAlias = npmScopePrefix;
  const sharedShadcnAlias = `${scopeAlias}${SHARED_SHADCN_NAME}`;
  const fullyQualifiedName = `${npmScopePrefix}${SHARED_SHADCN_NAME}`;
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
      {
        scopeAlias,
        ...esmVars(tree),
      },
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
        scopeAlias,
      },
      {
        overwriteStrategy: OverwriteStrategy.Overwrite,
      },
    );

    await configureTsProject(tree, {
      dir: libraryRoot,
      fullyQualifiedName,
    });

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
      withVersions([...SHADCN_DEPS]),
      {},
      joinPathFragments(libraryRoot, 'package.json'),
    );
  }

  updateJson(tree, 'tsconfig.base.json', (json) => ({
    ...json,
    compilerOptions: {
      ...json.compilerOptions,
      paths: {
        ...(json.compilerOptions?.paths ?? {}),
        [`${sharedShadcnAlias}/*`]: [
          `./${joinPathFragments(libraryRoot, 'src', '*')}`,
        ],
      },
    },
  }));

  // components.json lives in the package so `shadcn add` runs there and
  // installs component dependencies into the package's own manifest.
  if (!tree.exists(joinPathFragments(libraryRoot, 'components.json'))) {
    generateFiles(
      tree,
      joinPathFragments(import.meta.dirname, 'files', 'shadcn'),
      libraryRoot,
      {
        sharedShadcnAlias,
      },
      {
        overwriteStrategy: OverwriteStrategy.KeepExisting,
      },
    );
  }

  await formatFilesInSubtree(tree);
}
