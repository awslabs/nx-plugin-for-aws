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
 * CommonJS workspaces are marked with an explicit `type: "commonjs"` (which Node
 * treats identically to an absent `type`), so a `type` of anything other than
 * `commonjs` — including `module`, an absent `type`, or no root package.json —
 * is treated as ESM.
 */
export const isEsmWorkspace = (tree: Tree): boolean => {
  if (tree.exists('package.json')) {
    return readJson(tree, 'package.json').type !== 'commonjs';
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
