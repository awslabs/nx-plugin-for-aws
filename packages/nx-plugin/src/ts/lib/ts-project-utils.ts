/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  readProjectConfiguration,
  Tree,
  updateJson,
  updateProjectConfiguration,
} from '@nx/devkit';
import { join, relative } from 'path';
import { cjsToEsm } from '../cjs-to-esm/generator';
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
  const distDir = join(outDirToRootRelativePath, 'dist', options.dir);
  // Remove baseUrl and rootDir from the tsconfig.lib.json
  if (tree.exists(join(options.dir, 'tsconfig.lib.json'))) {
    updateJson(tree, join(options.dir, 'tsconfig.lib.json'), (tsConfig) => ({
      ...tsConfig,
      compilerOptions: {
        ...tsConfig.compilerOptions,
        baseUrl: undefined,
        rootDir: undefined,
        outDir: distDir,
        tsBuildInfoFile: join(distDir, 'tsconfig.lib.tsbuildinfo'),
      },
      include: undefined,
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
  // Convert cjs files to esm for eslint configs and source code, including root monorepo config.
  cjsToEsm(tree, '.', {
    include: ['eslint.config.js', '**/eslint.config.js', '**/src/**/*.ts'],
  });
  // Build task should both test and lint, so move build to compile and compose build as compile + test + lint
  const projectConfiguration = readProjectConfiguration(
    tree,
    options.fullyQualifiedName
  );
  if (
    projectConfiguration.targets.build &&
    projectConfiguration.targets.build.executor === '@nx/js:tsc'
  ) {
    projectConfiguration.targets.compile = projectConfiguration.targets.build;
    projectConfiguration.targets.build = {
      dependsOn: ['compile', 'lint', 'test'],
    };
    updateProjectConfiguration(
      tree,
      options.fullyQualifiedName,
      projectConfiguration
    );
  }
  configureEslint(tree, options);
  configureVitest(tree, options);
};
