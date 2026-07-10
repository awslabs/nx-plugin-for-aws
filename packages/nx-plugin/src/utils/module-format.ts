/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, type Tree } from '@nx/devkit';

/**
 * The module format for generated TypeScript code and configuration.
 */
export type ModuleFormat = 'esm' | 'cjs';

/**
 * Whether the workspace is configured for ES modules, inferred from the root
 * package.json. The module format is a workspace-wide property established when
 * the workspace is created, so shared infrastructure/construct helpers can read
 * it from the tree rather than having it threaded through every call site.
 *
 * ESM requires an explicit `type: "module"`, matching Node: an absent `type` (or
 * `type: "commonjs"`) means CommonJS. A workspace with no root package.json
 * defaults to ESM.
 */
export const isEsmWorkspace = (tree: Tree): boolean => {
  if (tree.exists('package.json')) {
    return readJson(tree, 'package.json').type === 'module';
  }
  return true;
};

/**
 * Returns the `esm` template variable for `generateFiles` substitutions,
 * inferred from the workspace root package.json. Spread into the substitution
 * object wherever a template contains `<% if (esm) { %>` conditionals.
 */
export const esmVars = (tree: Tree): { esm: boolean } => ({
  esm: isEsmWorkspace(tree),
});
