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
import PackageJson from '../../../package.json' with { type: 'json' };
import { isEsmWorkspace } from '../../utils/module-format';
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

  // Create an empty generators.json if one dosn't exist
  const generatorsJsonPath = joinPathFragments(project.root, 'generators.json');
  if (!tree.exists(generatorsJsonPath)) {
    writeJson(tree, generatorsJsonPath, {
      generators: {},
    });
  }

  // Create a package.json if one doesn't exist, and configure "type", "main"
  // and "generators"
  const pluginPackageJsonPath = joinPathFragments(project.root, 'package.json');
  if (!tree.exists(pluginPackageJsonPath)) {
    writeJson(tree, pluginPackageJsonPath, {
      name: project.name,
    });
  }
  const esm = isEsmWorkspace(tree);
  updateJson(tree, pluginPackageJsonPath, (pkg) => {
    // Match the plugin's module system to the workspace. Nx loads `.ts`
    // generators via Node's native type stripping, as ESM (workspace root is
    // `type: module`) or CommonJS accordingly.
    pkg.type ??= esm ? 'module' : 'commonjs';
    pkg.main ??= esm ? './src/index.js' : './src/index';
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
    // Generated workspaces are `"type": "module"`, so Nx loads the plugin's
    // `.ts` generators as ESM via Node's native type stripping — no swc/ts-node
    // transpiler is required.
    addDependenciesToPackageJson(tree, {}, deps);
    addDependenciesToPackageJson(tree, deps, {}, pluginPackageJsonPath);
  }
};
