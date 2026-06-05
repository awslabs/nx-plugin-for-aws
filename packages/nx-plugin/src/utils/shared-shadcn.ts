/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
  updateJson,
} from '@nx/devkit';
import tsProjectGenerator from '../ts/lib/generator';
import { configureTsProject } from '../ts/lib/ts-project-utils';
import { formatFilesInSubtree } from './format';
import { getNpmScopePrefix, toScopeAlias } from './npm-scope';
import { ensurePnpmIgnoresWorkspaceRootCheck } from './pnpm-workspace';
import {
  PACKAGES_DIR,
  SHARED_SHADCN_DIR,
  SHARED_SHADCN_NAME,
} from './shared-constructs-constants';
import { type ITsDepVersion, withVersions } from './versions';

const SHADCN_DEPS = [
  'class-variance-authority',
  'clsx',
  'tailwind-merge',
  'lucide-react',
  'tw-animate-css',
  'radix-ui',
] as const satisfies ITsDepVersion[];

export async function sharedShadcnGenerator(tree: Tree) {
  const npmScopePrefix = getNpmScopePrefix(tree);
  const scopeAlias = toScopeAlias(npmScopePrefix);
  const sharedShadcnAlias = `${scopeAlias}${SHARED_SHADCN_NAME}`;
  const fullyQualifiedName = `${npmScopePrefix}${SHARED_SHADCN_NAME}`;
  const libraryRoot = joinPathFragments(PACKAGES_DIR, SHARED_SHADCN_DIR);
  const shadcnSrcRoot = joinPathFragments(libraryRoot, 'src');
  ensurePnpmIgnoresWorkspaceRootCheck(tree);

  if (!tree.exists(joinPathFragments(libraryRoot, 'project.json'))) {
    await tsProjectGenerator(tree, {
      name: SHARED_SHADCN_NAME,
      directory: PACKAGES_DIR,
      subDirectory: SHARED_SHADCN_DIR,
    });

    tree.delete(shadcnSrcRoot);

    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files', SHARED_SHADCN_DIR, 'src'),
      shadcnSrcRoot,
      {
        scopeAlias,
      },
      {
        overwriteStrategy: OverwriteStrategy.KeepExisting,
      },
    );

    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files', SHARED_SHADCN_DIR, 'readme'),
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

    addDependenciesToPackageJson(tree, withVersions([...SHADCN_DEPS]), {});
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

  if (!tree.exists('components.json')) {
    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files', 'shadcn'),
      '.',
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
