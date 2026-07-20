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
 * Whether the workspace is configured for ES modules. The module format is a
 * workspace-wide property so shared infrastructure/construct helpers can read
 * it from the tree rather than having it threaded through every call site.
 *
 * Resolution order:
 * 1. An explicit root `type` wins — `"module"` is ESM, `"commonjs"` is CJS.
 *    The preset always writes this for a greenfield workspace.
 * 2. When the root `type` is absent (e.g. adopting the plugin into an existing
 *    Nx workspace, whose root manifest omits `type`), infer from existing
 *    projects: if any project declares `type: "module"` in its own
 *    package.json — as Nx's own TS-solution libraries do — the workspace is
 *    ESM, so generated projects match their siblings rather than defaulting to
 *    CJS and failing to import them.
 * 3. Otherwise CommonJS, matching Node's default for an absent `type`.
 *
 * A workspace with no root package.json defaults to ESM.
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

/**
 * Whether any project in the workspace declares `type: "module"` in its own
 * package.json. The root project is excluded since its absent `type` is the
 * case that led here.
 */
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
