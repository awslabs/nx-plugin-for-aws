/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { installPackagesTask, type Tree } from '@nx/devkit';
import { Logger, UVProvider } from './nxlv-python';
import type { ITsDepVersion } from './versions';

/**
 * Languages whose dependencies a generator may install.
 */
export type InstallLanguage = 'typescript' | 'python';

export interface InstallDependenciesOptions {
  /** Languages to install dependencies for. */
  languages: InstallLanguage[];
  /**
   * Packages that must resolve from the workspace after this generator, because
   * a config file it writes (e.g. `vite.config.mts`) imports them and Nx loads
   * that config when computing the project graph. When the caller prefers to
   * defer installing, we honour that only if these already resolve.
   *
   * The per-language graph deps in `LANGUAGE_GRAPH_DEPS` are always included, so
   * callers only list packages beyond those.
   */
  ensureResolvable?: ITsDepVersion[];
}

/**
 * Packages each language always needs resolvable for Nx to compute the project
 * graph, so a deferred install still runs whenever it would otherwise break.
 */
const LANGUAGE_GRAPH_DEPS: Record<InstallLanguage, string[]> = {
  typescript: ['vitest'], // every TypeScript project has a `vitest.config.mts`
  python: ['@nxlv/python'], // every Python project registers this inference plugin
};

/**
 * Returns true if every package is linked at `<root>/node_modules/<pkg>`.
 *
 * This is the condition Nx's inferred plugins need when they load a generated
 * config (e.g. `vite.config.mts`) during graph computation: the config's
 * imports resolve from inside the workspace's own `node_modules`. We avoid
 * `require.resolve`, which can succeed via an ancestor `node_modules` even when
 * the package isn't linked here. `existsSync` follows symlinks, so pnpm's store
 * links resolve, and Nx always uses a `node_modules` linker (never PnP).
 */
const allResolvable = (root: string, packages: string[]): boolean =>
  packages.every((pkg) => existsSync(join(root, 'node_modules', pkg)));

/**
 * Installs dependencies for the given languages.
 *
 * Call from a generator's returned callback:
 * `return () => installDependencies(tree, options.preferInstallDependencies, { ... })`.
 *
 * `preferInstallDependencies` is a preference: when `false` the install is
 * deferred so a batch installs once at the end — unless an `ensureResolvable`
 * package is missing, in which case it runs anyway so the next `nx` command can
 * still compute the project graph.
 */
export const installDependencies = async (
  tree: Tree,
  preferInstallDependencies: boolean | undefined,
  options: InstallDependenciesOptions,
): Promise<void> => {
  const { languages, ensureResolvable = [] } = options;
  const mustResolve = [
    ...ensureResolvable,
    ...languages.flatMap((language) => LANGUAGE_GRAPH_DEPS[language]),
  ];
  if (
    preferInstallDependencies === false &&
    allResolvable(tree.root, mustResolve)
  ) {
    return;
  }
  if (languages.includes('typescript')) {
    // Force the install: devkit's default only installs when the root
    // package.json changed, but deps land in per-project manifests.
    installPackagesTask(tree, true);
  }
  if (languages.includes('python')) {
    await new UVProvider(tree.root, new Logger(), tree).install();
  }
};
