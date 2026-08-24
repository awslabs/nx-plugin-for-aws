/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  type ProjectConfiguration,
  type Tree,
  updateJson,
  writeJson,
} from '@nx/devkit';
import type { PackageJson } from 'nx/src/utils/package-json';
import {
  type DependencyDeclaration,
  forDependencies,
  type MustDeclare,
} from '../../utils/declared-dependencies.js';
import { addDependenciesToPackageJson } from '../../utils/dependencies.js';
import { isEsmWorkspace } from '../../utils/module-format.js';
import {
  nxPluginSelfDependency,
  readProjectConfigurationUnqualified,
} from '../../utils/nx.js';
import { type ITsDepVersion, withVersions } from '../../utils/versions.js';

/** Dependencies a caller must declare to configure an Nx Plugin project. */
export const NX_PLUGIN_DEPENDENCIES = [
  { name: '@nx/devkit' },
] as const satisfies readonly { name: ITsDepVersion }[];

/**
 * Read the configuration of a project which can host Nx Plugin generators or
 * migrations, ie a TypeScript project.
 */
export const readNxPluginProject = (
  tree: Tree,
  projectName: string,
): ProjectConfiguration => {
  const project = readProjectConfigurationUnqualified(tree, projectName);

  const tsConfigPath = joinPathFragments(project.root, 'tsconfig.json');
  if (!tree.exists(tsConfigPath)) {
    throw new Error(
      `Selected plugin project ${projectName} is not a TypeScript project`,
    );
  }

  return project;
};

/** `package.json` field pointing Nx at one of a plugin's manifests. */
type NxPluginManifestField = 'generators' | 'nx-migrations';

/**
 * Create the plugin project's package.json if absent and point it at the given
 * manifest, returning its path.
 */
export const configureNxPluginPackageJson = <
  TField extends NxPluginManifestField,
>(
  tree: Tree,
  project: ProjectConfiguration,
  manifestField: TField,
  manifestValue: PackageJson[TField],
): string => {
  const pluginPackageJsonPath = joinPathFragments(project.root, 'package.json');
  if (!tree.exists(pluginPackageJsonPath)) {
    writeJson(tree, pluginPackageJsonPath, {
      name: project.name,
    });
  }
  const esm = isEsmWorkspace(tree);
  updateJson(tree, pluginPackageJsonPath, (pkg) => {
    // Match the plugin's module system to the workspace. Nx loads `.ts` files
    // via Node's native type stripping, as ESM (workspace root is
    // `type: module`) or CommonJS accordingly.
    pkg.type ??= esm ? 'module' : 'commonjs';
    pkg.main ??= esm ? './src/index.js' : './src/index';
    pkg[manifestField] ??= manifestValue;
    return pkg;
  });
  return pluginPackageJsonPath;
};

/**
 * Declare the dependencies the plugin's `.ts` files import on both the
 * workspace and the plugin, since both must resolve for Nx to load them. A
 * no-op inside the plugin's own monorepo, where they are already present.
 */
export const addNxPluginDependencies = <const D extends DependencyDeclaration>(
  tree: Tree,
  pluginPackageJsonPath: string,
  declaration: D & MustDeclare<typeof NX_PLUGIN_DEPENDENCIES, D>,
): void => {
  const selfDependency = nxPluginSelfDependency(tree);
  if (Object.keys(selfDependency).length === 0) {
    return;
  }
  const deps = {
    ...withVersions(
      forDependencies<typeof NX_PLUGIN_DEPENDENCIES>(declaration),
      ['@nx/devkit'],
    ),
    ...selfDependency,
  };
  addDependenciesToPackageJson(tree, {}, deps);
  addDependenciesToPackageJson(tree, deps, {}, pluginPackageJsonPath);
};

/**
 * Configures a TypeScript project as an Nx Plugin
 */
export const configureTsProjectAsNxPlugin = <
  const D extends DependencyDeclaration,
>(
  tree: Tree,
  projectName: string,
  declaration: D & MustDeclare<typeof NX_PLUGIN_DEPENDENCIES, D>,
) => {
  const project = readNxPluginProject(tree, projectName);

  // Create an empty generators.json if one dosn't exist
  const generatorsJsonPath = joinPathFragments(project.root, 'generators.json');
  if (!tree.exists(generatorsJsonPath)) {
    writeJson(tree, generatorsJsonPath, {
      generators: {},
    });
  }

  const pluginPackageJsonPath = configureNxPluginPackageJson(
    tree,
    project,
    'generators',
    './generators.json',
  );

  addNxPluginDependencies(
    tree,
    pluginPackageJsonPath,
    forDependencies<typeof NX_PLUGIN_DEPENDENCIES>(declaration),
  );
};
