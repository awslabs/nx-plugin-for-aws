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
  /** Module format. Defaults to the workspace format, written explicitly. */
  readonly esm?: boolean;
}

/**
 * Ensure the project has its own minimal private package.json, so the workspace
 * follows the standard npm package layout (package managers link projects,
 * filtered installs work, nearest-package.json `type` lookup resolves).
 * Cross-project imports resolve via tsconfig `paths` aliases, not the manifest.
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
    // Strip @nx/js's default `./dist` entry points: that path doesn't exist in
    // this layout (tsc outputs to `dist/<project>/tsc` at the root) and imports
    // resolve via tsconfig aliases. User-customised entry points are kept.
    for (const field of ['main', 'module', 'types'] as const) {
      if (packageJson[field]?.startsWith('./dist/')) {
        delete packageJson[field];
      }
    }
    if (packageJson.exports?.['.']?.import?.startsWith('./dist/')) {
      // Drop only the stale default entry; user-added subpath exports are kept.
      // Its './package.json' companion is dropped too, since an exports map
      // without '.' would block root imports.
      delete packageJson.exports['.'];
      const remaining = Object.keys(packageJson.exports);
      if (
        remaining.length === 0 ||
        (remaining.length === 1 && remaining[0] === './package.json')
      ) {
        delete packageJson.exports;
      }
    }
    return {
      ...packageJson,
      name: options.fullyQualifiedName,
      private: packageJson.private ?? true,
      // Written explicitly so the module format is stable however consumed.
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
  // Update whichever markers the workspace carries (both when both are
  // present, e.g. the test helper).
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
    const { workspaces } = readJson<{ workspaces?: WorkspacesField }>(
      tree,
      'package.json',
    );
    if (
      workspaces !== undefined &&
      !globsCover(workspaceGlobs(workspaces), dir)
    ) {
      updateJson(tree, 'package.json', (packageJson) => ({
        ...packageJson,
        workspaces: appendWorkspaceGlob(packageJson.workspaces, dir),
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
 * The root package.json `workspaces` field: an array of globs, or the object
 * form (`{ "packages": [...] }`) accepted by yarn and bun.
 */
export type WorkspacesField = string[] | { packages?: string[] };

/** The workspace globs carried by either form of the `workspaces` field. */
export const workspaceGlobs = (
  workspaces: WorkspacesField | undefined,
): string[] =>
  Array.isArray(workspaces) ? workspaces : (workspaces?.packages ?? []);

/** Append a glob to the `workspaces` field, preserving its existing form. */
const appendWorkspaceGlob = (
  workspaces: WorkspacesField | undefined,
  glob: string,
): WorkspacesField => {
  const globs = [...workspaceGlobs(workspaces), glob];
  return workspaces !== undefined && !Array.isArray(workspaces)
    ? { ...workspaces, packages: globs }
    : globs;
};

/**
 * Whether the workspace globs match the directory. Negated globs (`!foo`)
 * always exclude, regardless of where they appear in the list — package
 * managers apply exclusions after expanding the positive patterns, so
 * ordering is not significant.
 */
const globsCover = (globs: string[], dir: string): boolean =>
  globs.some((glob) => !glob.startsWith('!') && minimatch(dir, glob)) &&
  !globs.some((glob) => glob.startsWith('!') && minimatch(dir, glob.slice(1)));
