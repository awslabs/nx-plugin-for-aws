/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { readJson, readNxJson, type Tree } from '@nx/devkit';
import { pyProjectGenerator } from '../sdk/py';
import { tsProjectGenerator } from '../sdk/ts';
import { declaredNames } from './declared-dependencies.js';
import { INIT_DEPENDENCIES } from './init.js';
import { createTreeUsingTsSolutionSetup } from './test.js';

/**
 * The package a plugin entry in `nx.json` resolves to, e.g. `@nx/js/typescript`
 * resolves to `@nx/js`.
 */
const pluginPackageName = (plugin: string): string => {
  const parts = plugin.split('/');
  return plugin.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};

/** The plugin packages a workspace's `nx.json` registers. */
const registeredPlugins = (tree: Tree): string[] => [
  ...new Set(
    (readNxJson(tree)?.plugins ?? [])
      .map((entry) => (typeof entry === 'string' ? entry : entry.plugin))
      .map(pluginPackageName),
  ),
];

/**
 * The plugins registered in `nx.json` that no manifest declares.
 *
 * `init` runs on every real workspace, so what it declares counts as declared
 * here even though these tests run the project generators on their own.
 */
const undeclaredPlugins = (tree: Tree): string[] => {
  const pkg = readJson(tree, 'package.json');
  const declared = new Set<string>([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...declaredNames<string>([...INIT_DEPENDENCIES]),
  ]);
  return registeredPlugins(tree).filter((name) => !declared.has(name));
};

/**
 * Nx loads a plugin named in `nx.json` itself, so nothing else in the repo
 * catches one that no manifest declares. Lint only sees what source files
 * import, and Nx resolves plugins from its own directory — where a package
 * manager may have placed the package as a transitive of something else the
 * workspace depends on. That masks a missing declaration everywhere it would
 * otherwise surface: the workspace builds and the smoke tests pass, leaving
 * only a user whose install lays node_modules out differently to hit
 * `Plugin listed in nx.json not found`.
 *
 * Comparing the two files directly is immune to that, since it resolves nothing.
 */
describe('nx plugin declarations', () => {
  it('should declare the plugins ts#project registers', async () => {
    const tree = createTreeUsingTsSolutionSetup();
    await tsProjectGenerator(tree, {
      name: 'test-lib',
      preferInstallDependencies: false,
    });

    expect(undeclaredPlugins(tree)).toEqual([]);
  });

  it('should declare the plugins py#project registers', async () => {
    const tree = createTreeUsingTsSolutionSetup();
    await pyProjectGenerator(tree, {
      name: 'test_py',
      moduleName: 'test_py',
      preferInstallDependencies: false,
    });

    expect(undeclaredPlugins(tree)).toEqual([]);
  });
});
