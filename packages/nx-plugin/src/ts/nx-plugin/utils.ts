/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  joinPathFragments,
  readJson,
  type Tree,
  updateJson,
  writeJson,
} from '@nx/devkit';
import PackageJson from '../../../package.json';
import { readProjectConfigurationUnqualified } from '../../utils/nx';
import { withVersions } from '../../utils/versions';

/**
 * Configures a TypeScript project as an Nx Plugin
 */
export const configureTsProjectAsNxPlugin = (
  tree: Tree,
  projectName: string,
) => {
  const project = readProjectConfigurationUnqualified(tree, projectName);

  const tsConfigPath = joinPathFragments(project.root, 'tsconfig.json');
  if (!tree.exists(tsConfigPath)) {
    throw new Error(
      `Selected plugin project ${projectName} is not a TypeScript project`,
    );
  }

  // Nx Plugins must use commonjs as a limitation of nx
  // https://github.com/nrwl/nx/issues/15682
  updateJson(tree, tsConfigPath, (tsConfig) => {
    const { module, moduleResolution, ...rest } =
      tsConfig.compilerOptions ?? {};
    // Reassign module/moduleResolution last in a fixed order so re-running
    // produces a stable key order regardless of whether a prior step removed
    // `module` (eg configureTsProject drops a conflicting commonjs module).
    // TypeScript 6 allows bundler + commonjs together, avoiding deprecated node/node10
    tsConfig.compilerOptions = {
      ...rest,
      module: module ?? 'commonjs',
      moduleResolution: moduleResolution ?? 'bundler',
    };
    return tsConfig;
  });

  // Create an empty generators.json if one dosn't exist
  const generatorsJsonPath = joinPathFragments(project.root, 'generators.json');
  if (!tree.exists(generatorsJsonPath)) {
    writeJson(tree, generatorsJsonPath, {
      generators: {},
    });
  }

  // Create a package.json if one doesn't exist, and configure "main" and "generators"
  const pluginPackageJsonPath = joinPathFragments(project.root, 'package.json');
  if (!tree.exists(pluginPackageJsonPath)) {
    writeJson(tree, pluginPackageJsonPath, {
      name: project.name,
    });
  }
  updateJson(tree, pluginPackageJsonPath, (pkg) => {
    pkg.main ??= './src/index.js';
    pkg.generators ??= './generators.json';
    return pkg;
  });

  const rootPackageJson = tree.exists('package.json')
    ? readJson(tree, 'package.json')
    : undefined;
  const isNxPluginForAws = rootPackageJson?.name === '@aws/nx-plugin-source';

  if (!isNxPluginForAws) {
    // Add the required dependencies to the root package.json, and project's package.json
    const deps = {
      ...withVersions(['@nx/devkit']),
      // Include dependency on @aws/nx-plugin
      [PackageJson.name]: `^${PackageJson.version}`,
    };
    // Nx transpiles unbuilt plugin generators on the fly. With @swc-node/register
    // present it uses swc; otherwise it falls back to ts-node, which forces the
    // deprecated `moduleResolution: node10` — a hard error under TypeScript 6.
    // Ensure swc is available so generators run regardless of the installed
    // TypeScript version. ESM migration tracked in awslabs/nx-plugin-for-aws#814.
    const devDeps = withVersions(['@swc-node/register', '@swc/core']);
    addDependenciesToPackageJson(tree, {}, { ...deps, ...devDeps });
    addDependenciesToPackageJson(tree, deps, devDeps, pluginPackageJsonPath);
  }
};
