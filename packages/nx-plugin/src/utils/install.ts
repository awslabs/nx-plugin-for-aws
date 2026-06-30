/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { installPackagesTask, type Tree } from '@nx/devkit';
import { Logger, UVProvider } from './nxlv-python';

/**
 * Languages whose dependencies a generator may install.
 */
export type InstallLanguage = 'typescript' | 'python';

export interface InstallDepsOptions {
  /** Languages to install dependencies for. */
  languages: InstallLanguage[];
  /**
   * Extra packages that MUST be resolvable from the workspace after this
   * generator, because a config file it writes (e.g. `vite.config.mts`) imports
   * them and Nx loads that config when computing the project graph on the next
   * command — for example a website's `@tailwindcss/vite`.
   *
   * `vitest` is always included for the `typescript` language (every TypeScript
   * project this plugin scaffolds has a `vitest.config.mts`), so callers only
   * list packages beyond that.
   *
   * When the user prefers to defer installing, we honour that ONLY if these are
   * already resolvable; otherwise we install anyway so the next `nx` command
   * doesn't fail computing the project graph.
   */
  ensureResolvable?: string[];
}

/**
 * Packages every TypeScript project this plugin generates relies on in a config
 * file Nx loads during project-graph computation. Ensuring these resolve means
 * a deferred install still happens whenever it would otherwise break the graph
 * — so composed generators don't each have to declare them.
 */
const LANGUAGE_GRAPH_DEPS: Record<InstallLanguage, string[]> = {
  // Every TypeScript project has a `vitest.config.mts` (loaded by `@nx/vitest`).
  typescript: ['vitest'],
  // Every Python project registers the `@nxlv/python` inference plugin.
  python: ['@nxlv/python'],
};

/**
 * Returns true if every package in `packages` is linked at the top level of the
 * workspace's `node_modules`, i.e. `<root>/node_modules/<pkg>` exists.
 *
 * This is the condition Nx's inferred plugins need when they load a project's
 * generated config (e.g. `vite.config.mts`) during project-graph computation:
 * the config's `import 'vitest'` is resolved from a temp file inside the
 * workspace's own `node_modules`, so the package must be physically present
 * there. `require.resolve(..., { paths: [root] })` is too permissive — it can
 * succeed via the resolving module's own ancestor `node_modules` (the compiled
 * plugin lives under `node_modules/@aws/nx-plugin`) even when the package is not
 * yet linked into this workspace, causing us to wrongly defer an install the
 * next `nx` command then fails on.
 *
 * `existsSync` follows symlinks, so pnpm's `node_modules/<pkg>` → store link
 * resolves correctly, and Nx always uses a `node_modules` linker (it writes
 * `nodeLinker: node-modules` for Yarn Berry, so PnP never applies).
 */
const allResolvable = (root: string, packages: string[]): boolean =>
  packages.every((pkg) => existsSync(join(root, 'node_modules', pkg)));

/**
 * Installs dependencies for the given languages.
 *
 * Call this from a generator's returned callback:
 * `return () => installDeps(tree, options.preferInstallDependencies, { ... })`.
 *
 * `preferInstallDependencies` is a preference, not a guarantee: when `false`,
 * the install is deferred so a batch of generators can install once at the
 * end — UNLESS skipping would leave an `ensureResolvable` package missing, in
 * which case the install runs regardless so the next `nx` command can still
 * compute the project graph.
 *
 * @example
 * return () =>
 *   installDeps(tree, options.preferInstallDependencies, {
 *     languages: ['typescript'],
 *     ensureResolvable: ['@tailwindcss/vite'],
 *   });
 */
export const installDeps = async (
  tree: Tree,
  preferInstallDependencies: boolean | undefined,
  options: InstallDepsOptions,
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
    installPackagesTask(tree);
  }
  if (languages.includes('python')) {
    await new UVProvider(tree.root, new Logger(), tree).install();
  }
};
