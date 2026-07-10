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
 * The module format option exposed to generators. `infer` resolves to `esm` or
 * `cjs` based on the workspace's root package.json `type` field.
 */
export type ModuleFormatOption = ModuleFormat | 'infer';

/**
 * Resolve the module format to use, inferring from the root package.json when
 * `infer` is selected: `type: "commonjs"` implies `cjs`, everything else
 * (including `type: "module"`, an absent `type`, or no root package.json)
 * implies `esm`. CommonJS workspaces are marked with an explicit
 * `type: "commonjs"` (which Node treats identically to an absent `type`) so
 * that inference can distinguish an established CommonJS workspace from a fresh
 * one where ESM remains the default.
 */
export const resolveModuleFormat = (
  tree: Tree,
  option: ModuleFormatOption | undefined,
): ModuleFormat => {
  const resolved = option ?? 'infer';
  if (resolved === 'esm' || resolved === 'cjs') {
    return resolved;
  }
  if (tree.exists('package.json')) {
    return readJson(tree, 'package.json').type === 'commonjs' ? 'cjs' : 'esm';
  }
  return 'esm';
};

/**
 * Whether the workspace is configured for ES modules, inferred from the root
 * package.json. The module format is a workspace-wide property established when
 * the workspace (or its first TypeScript project) is created, so shared
 * infrastructure/construct helpers can read it from the tree rather than having
 * it threaded through every call site.
 */
export const isEsmWorkspace = (tree: Tree): boolean =>
  resolveModuleFormat(tree, 'infer') === 'esm';

/**
 * Returns the `esm` template variable for `generateFiles` substitutions,
 * inferred from the workspace root package.json. Spread into the substitution
 * object wherever a template contains `<% if (esm) { %>` conditionals.
 */
export const esmVars = (tree: Tree): { esm: boolean } => ({
  esm: isEsmWorkspace(tree),
});
