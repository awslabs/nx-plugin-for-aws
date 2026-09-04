/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { joinPathFragments, readJson, type Tree } from '@nx/devkit';
import {
  addDependenciesToPackageJson,
  getLocalDependencySpecifier,
} from './dependencies.js';

/** A cross-project import a generator emits. */
export interface LocalProjectDependency {
  /** Root of the project whose generated source contains the import. */
  readonly consumerRoot: string;
  /** Root of the project being imported. */
  readonly dependencyRoot: string;
}

/**
 * Declare a generated cross-project import in the importing project's own
 * `package.json`, so a freshly generated workspace passes `lint`.
 *
 * `noUndeclaredDependencies` fails a project whose source imports a package its
 * manifest doesn't declare. The `ts#sync` generator derives that from the
 * project graph, but only runs as part of a task run — so a workspace that has
 * never built fails `lint` before it has had the chance to, on generated code
 * the user never touched.
 *
 * The specifier matches what `ts#sync` writes, so the two agree and re-running
 * either is a no-op. TypeScript project references are left to
 * `@nx/js:typescript-sync`, which owns resolving them. Sync stays the safety
 * net for imports the user adds themselves.
 */
export const addLocalProjectDependency = (
  tree: Tree,
  { consumerRoot, dependencyRoot }: LocalProjectDependency,
): void => {
  const dependencyManifest = joinPathFragments(dependencyRoot, 'package.json');
  const consumerManifest = joinPathFragments(consumerRoot, 'package.json');
  if (!tree.exists(dependencyManifest) || !tree.exists(consumerManifest)) {
    return;
  }
  const packageName = readJson<{ name?: string }>(
    tree,
    dependencyManifest,
  ).name;
  if (!packageName) {
    return;
  }
  const { dependencies = {}, devDependencies = {} } = readJson<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>(tree, consumerManifest);
  // Declared in either list already — leave the user's choice alone.
  if (dependencies[packageName] || devDependencies[packageName]) {
    return;
  }
  addDependenciesToPackageJson(
    tree,
    { [packageName]: getLocalDependencySpecifier(tree) },
    {},
    consumerManifest,
  );
};
