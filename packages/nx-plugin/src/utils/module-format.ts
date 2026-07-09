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
 * The module format the workspace has already established, read from an
 * explicit root package.json `type` (`module` -> esm, `commonjs` -> cjs).
 * Returns `undefined` when there is no root package.json or it has no `type`,
 * i.e. the format is not yet established and a generator is free to set it.
 */
export const getEstablishedModuleFormat = (
  tree: Tree,
): ModuleFormat | undefined => {
  if (!tree.exists('package.json')) {
    return undefined;
  }
  const type = readJson(tree, 'package.json').type;
  if (type === 'commonjs') {
    return 'cjs';
  }
  if (type === 'module') {
    return 'esm';
  }
  return undefined;
};

const MODULE_FORMAT_LABELS: Record<ModuleFormat, string> = {
  esm: 'ES modules (esm)',
  cjs: 'CommonJS (cjs)',
};

/**
 * Throws when an explicit `--module` selection conflicts with the format the
 * workspace has already established. The module format is workspace-wide (a
 * single root package.json `type`), so adding a project of the other format
 * would flip the whole workspace and break every existing project, whose
 * sources are already generated for the current format. `infer` never
 * conflicts, and a workspace with no established format is left for the
 * generator to set.
 */
export const assertModuleFormatCompatible = (
  tree: Tree,
  option: ModuleFormatOption | undefined,
): void => {
  const requested = option ?? 'infer';
  if (requested === 'esm' || requested === 'cjs') {
    const established = getEstablishedModuleFormat(tree);
    if (established && established !== requested) {
      throw new Error(
        `Cannot generate a ${MODULE_FORMAT_LABELS[requested]} project in a workspace already configured for ${MODULE_FORMAT_LABELS[established]}. ` +
          `The module format is workspace-wide, so mixing ESM and CommonJS projects in one workspace is not supported. ` +
          `Omit --module (or pass --module=infer) to match the workspace, or create a new workspace with --module=${requested}.`,
      );
    }
  }
};

/**
 * Returns the `esm` template variable for `generateFiles` substitutions,
 * inferred from the workspace root package.json. Spread into the substitution
 * object wherever a template contains `<% if (esm) { %>` conditionals.
 */
export const esmVars = (tree: Tree): { esm: boolean } => ({
  esm: isEsmWorkspace(tree),
});
