/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  readJson,
  type Tree,
  updateJson,
  writeJson,
} from '@nx/devkit';
import yaml from 'js-yaml';
import { minimatch } from 'minimatch';
import { detectWorkspacePackageManager } from './dependencies';
import { isEsmWorkspace } from './module-format';

export interface EnsureProjectPackageJsonOptions {
  /** Directory of the project relative to the workspace root */
  readonly dir: string;
  /** Full package name including scope (eg @foo/bar) */
  readonly fullyQualifiedName: string;
  /**
   * Module format for the project. Defaults to the workspace format. Written
   * explicitly so Node's nearest-package.json `type` resolution matches the
   * workspace format regardless of intermediate manifests.
   */
  readonly esm?: boolean;
}

/**
 * Ensure the project has its own package.json.
 *
 * Projects carry a minimal private manifest so the workspace follows the
 * standard npm package layout: package managers link workspace projects,
 * `pnpm add --filter <project>` works, and tooling that resolves the nearest
 * package.json (eg Node's `type` lookup) sees the right module format.
 *
 * Cross-project imports resolve through the `paths` aliases in
 * tsconfig.base.json rather than the manifest, so projects don't need to
 * declare local dependencies or an `exports` map — deployable projects are
 * always bundled. Third-party runtime dependencies a project's source imports
 * are declared in its own manifest as `catalog:` references (build/test
 * tooling stays in the root package.json); the catalog keeps versions aligned
 * across the workspace (single-version policy).
 */
export const ensureProjectPackageJson = (
  tree: Tree,
  options: EnsureProjectPackageJsonOptions,
): void => {
  const packageJsonPath = joinPathFragments(options.dir, 'package.json');
  const esm = options.esm ?? isEsmWorkspace(tree);

  if (!tree.exists(packageJsonPath)) {
    writeJson(tree, packageJsonPath, {
      name: options.fullyQualifiedName,
      version: '0.0.0',
      private: true,
    });
  }

  updateJson(tree, packageJsonPath, (packageJson) => {
    // Strip @nx/js's default entry points: they reference a per-project
    // `./dist` directory which doesn't exist in this layout (tsc outputs to
    // `dist/<project>/tsc` at the workspace root), and imports resolve via
    // tsconfig path aliases instead. Entry points the user has customised
    // (any value not referencing ./dist) are kept.
    for (const field of ['main', 'module', 'types'] as const) {
      if (packageJson[field]?.startsWith('./dist/')) {
        delete packageJson[field];
      }
    }
    if (packageJson.exports?.['.']?.import?.startsWith('./dist/')) {
      delete packageJson.exports;
    }
    return {
      ...packageJson,
      name: options.fullyQualifiedName,
      private: packageJson.private ?? true,
      // Written explicitly (not inherited from the root) so the project's
      // module format is stable however the file is consumed.
      type: esm ? 'module' : 'commonjs',
    };
  });

  ensureWorkspaceGlobCovers(tree, options.dir);
};

/**
 * Ensure the package manager's workspace globs match the given project
 * directory, so the project's package.json participates in workspace
 * resolution and filtered installs.
 *
 * pnpm reads globs from `pnpm-workspace.yaml`; other package managers read
 * the root package.json `workspaces` field. A directory not covered by an
 * existing glob is added as an exact entry.
 */
export const ensureWorkspaceGlobCovers = (tree: Tree, dir: string): void => {
  // pnpm reads globs from pnpm-workspace.yaml; every other package manager
  // reads the root package.json `workspaces` field. Update whichever the
  // workspace carries (both when both are present, e.g. the test helper).
  const usePnpmWorkspace = detectWorkspacePackageManager(tree) === 'pnpm';

  if (usePnpmWorkspace) {
    const parsed =
      (yaml.load(tree.read('pnpm-workspace.yaml', 'utf-8') ?? '') as Record<
        string,
        unknown
      >) ?? {};
    const packages = (parsed.packages as string[]) ?? [];
    if (!globsCover(packages, dir)) {
      tree.write(
        'pnpm-workspace.yaml',
        yaml.dump(
          { ...parsed, packages: [...packages, dir] },
          { quotingType: "'" },
        ),
      );
    }
  }

  if (tree.exists('package.json')) {
    const { workspaces } = readJson<{ workspaces?: string[] }>(
      tree,
      'package.json',
    );
    if (workspaces !== undefined && !globsCover(workspaces, dir)) {
      updateJson(tree, 'package.json', (packageJson) => ({
        ...packageJson,
        workspaces: [...(packageJson.workspaces ?? []), dir],
      }));
    } else if (workspaces === undefined && !usePnpmWorkspace) {
      updateJson(tree, 'package.json', (packageJson) => ({
        ...packageJson,
        workspaces: [dir],
      }));
    }
  }
};

/**
 * Whether the workspace globs match the directory. Negated globs (`!foo`)
 * exclude matches from preceding patterns, mirroring how package managers
 * interpret workspace globs — `some(minimatch)` would treat a lone negation
 * as matching nearly everything.
 */
const globsCover = (globs: string[], dir: string): boolean => {
  let covered = false;
  for (const glob of globs) {
    if (glob.startsWith('!')) {
      if (minimatch(dir, glob.slice(1))) {
        covered = false;
      }
    } else if (minimatch(dir, glob)) {
      covered = true;
    }
  }
  return covered;
};
