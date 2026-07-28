/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  readJson,
  type Tree,
} from '@nx/devkit';

/**
 * The module format for generated TypeScript code and configuration.
 */
export type ModuleFormat = 'esm' | 'cjs';

/**
 * Whether the workspace targets ES modules, read from the tree so shared
 * helpers needn't thread it through call sites. An explicit root `type` wins
 * (`module`/`commonjs`); when absent (e.g. an adopted Nx workspace) infer ESM
 * from any sibling project declaring `type: "module"`, else CJS. No root
 * package.json defaults to ESM.
 */
export const isEsmWorkspace = (tree: Tree): boolean => {
  if (!tree.exists('package.json')) {
    return true;
  }
  const rootType = readJson(tree, 'package.json').type;
  if (rootType === 'module') {
    return true;
  }
  if (rootType === 'commonjs') {
    return false;
  }
  // Root `type` is absent: infer from sibling projects' own manifests.
  return hasEsmProject(tree);
};

/** Whether any non-root project declares `type: "module"` in its own manifest. */
const hasEsmProject = (tree: Tree): boolean => {
  for (const project of getProjects(tree).values()) {
    if (project.root === '.' || project.root === '') {
      continue;
    }
    const packageJsonPath = joinPathFragments(project.root, 'package.json');
    if (
      tree.exists(packageJsonPath) &&
      readJson(tree, packageJsonPath).type === 'module'
    ) {
      return true;
    }
  }
  return false;
};

/**
 * Returns the `esm` template variable for `generateFiles` substitutions,
 * inferred from the workspace root package.json. Spread into the substitution
 * object wherever a template contains `<% if (esm) { %>` conditionals.
 */
export const esmVars = (tree: Tree): { esm: boolean } => ({
  esm: isEsmWorkspace(tree),
});
