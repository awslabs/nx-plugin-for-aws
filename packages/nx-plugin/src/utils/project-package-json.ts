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
      // Drop only the stale default entry — user-added subpath exports are
      // kept. The './package.json' companion @nx/js emits alongside it is
      // dropped too: an exports map without '.' would block root imports.
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
