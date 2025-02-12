/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { joinPathFragments, Tree, updateJson } from '@nx/devkit';
import { join, relative } from 'path';
import { toScopeAlias } from '../../utils/npm-scope';
import { ConfigureProjectOptions } from './types';
import { configureVitest } from './vitest';
import { configureEslint } from './eslint';

/**
 * Updates typescript projects
 */
export const configureTsProject = (
  tree: Tree,
  options: ConfigureProjectOptions
) => {
  // Remove conflicting commonjs module from tsconfig
  updateJson(tree, join(options.dir, 'tsconfig.json'), (tsConfig) => ({
    ...tsConfig,
    compilerOptions: {
      ...tsConfig.compilerOptions,
      module:
        tsConfig.compilerOptions?.module === 'commonjs'
          ? undefined
          : tsConfig.compilerOptions?.module,
    },
  }));
  const outDirToRootRelativePath = relative(
    join(tree.root, options.dir),
    tree.root
  );
  const distDir = join(outDirToRootRelativePath, 'dist', options.dir, 'tsc');
  // Remove baseUrl and rootDir from the tsconfig.lib.json
  if (tree.exists(join(options.dir, 'tsconfig.lib.json'))) {
    updateJson(tree, join(options.dir, 'tsconfig.lib.json'), (tsConfig) => ({
      ...tsConfig,
      compilerOptions: {
        ...tsConfig.compilerOptions,
        baseUrl: undefined,
        rootDir: '.',
        outDir: distDir,
        tsBuildInfoFile: join(distDir, options.dir, 'tsconfig.lib.tsbuildinfo'),
      },
    }));
  }
  // Update root project tsconfig
  updateJson(tree, 'tsconfig.base.json', (tsConfig) => ({
    ...tsConfig,
    compilerOptions: {
      ...tsConfig.compilerOptions,
      baseUrl: '.',
      rootDir: '.',
      paths: {
        // Remove any path aliases for this project with the npm scope prefix (eg remove @foo/bar)
        ...Object.fromEntries(
          Object.entries(tsConfig.compilerOptions?.paths ?? {}).filter(
            ([k]) => k !== options.fullyQualifiedName
          )
        ),
        // Add aliases which begin with colon (eg :foo/bar) to avoid sniping attacks
        [toScopeAlias(options.fullyQualifiedName)]: [
          joinPathFragments(options.dir, 'src', 'index.ts'),
          joinPathFragments('dist', options.dir, 'src', 'index.d.ts'),
        ],
      },
    },
  }));
  if (tree.exists('tsconfig.json')) {
    updateJson(tree, 'tsconfig.json', (tsConfig) => ({
      ...tsConfig,
      references: [
        // Add project references, ensuring no duplication
        ...(tsConfig.references ?? []).filter(
          (ref) => ref.path !== `./${options.dir}`
        ),
        {
          path: `./${options.dir}`,
        },
      ],
    }));
  }
  // Update the root package.json
  updateJson(tree, 'package.json', (packageJson) => ({
    ...packageJson,
    type: 'module',
  }));
  // Remove package.json if it exists
  if (tree.exists(join(options.dir, 'package.json'))) {
    tree.delete(join(options.dir, 'package.json'));
  }

  configureEslint(tree);
  configureVitest(tree, options);
};
