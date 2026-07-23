/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  detectPackageManager,
  addDependenciesToPackageJson as devkitAddDependenciesToPackageJson,
  type GeneratorCallback,
  getPackageManagerVersion,
  type PackageManager,
  readJson,
  type Tree,
  updateJson,
} from '@nx/devkit';
import yaml from 'js-yaml';
import { coerce, gt, gte } from 'semver';
import { readAwsNxPluginConfigSync } from './config/utils';

/**
 * Package managers with catalog support, and the version that introduced it.
 * npm has no catalog feature; workspaces using npm receive direct version
 * ranges instead (the docs recommend syncpack for aligning those).
 */
const CATALOG_SUPPORT: Partial<Record<PackageManager, string>> = {
  pnpm: '9.5.0',
  yarn: '4.10.0',
  bun: '1.2.14',
};

/**
 * Detect the workspace's package manager, preferring markers in the tree over
 * `detectPackageManager` (which reads the real filesystem and falls back to
 * the invoking package manager's user agent — nondeterministic for virtual
 * trees in tests).
 */
export const detectWorkspacePackageManager = (tree: Tree): PackageManager =>
  tree.exists('pnpm-workspace.yaml') ? 'pnpm' : detectPackageManager(tree.root);

/**
 * Parse a version or simple range (an optional `^`/`~`/`>=` prefix followed
 * by a version) for comparison. Returns undefined for anything else (tags,
 * protocols, compound ranges), which callers treat as user-customised and
 * never overwrite.
 */
const parseSimpleRange = (version: string) => {
  const match = /^(?:\^|~|>=)?(\d[0-9A-Za-z.-]*)$/.exec(version.trim());
  return match
    ? (coerce(match[1], { includePrerelease: true }) ?? undefined)
    : undefined;
};

const versionAtLeast = (version: string, minimum: string): boolean =>
  gte(
    parseSimpleRange(version) ?? '0.0.0',
    parseSimpleRange(minimum) ?? '0.0.0',
  );

/**
 * Whether `incoming` should replace `existing` as a catalog version. Only a
 * strictly greater version replaces the existing entry, so generating a new
 * project never downgrades a version the user has upgraded in the catalog.
 * An entry that can't be compared (a tag or complex range) is always kept.
 */
const isVersionUpgrade = (incoming: string, existing: string): boolean => {
  const existingParsed = parseSimpleRange(existing);
  const incomingParsed = parseSimpleRange(incoming);
  if (!existingParsed || !incomingParsed) {
    return false;
  }
  return gt(incomingParsed, existingParsed);
};

// Memoised per workspace root and package manager: detecting catalog support
// shells out to the package manager for its version, which is too slow to
// repeat per call.
const catalogSupportCache = new Map<string, boolean>();

/** Clears the catalog support cache. Only needed by tests. */
export const resetCatalogSupportCache = (): void => {
  catalogSupportCache.clear();
};

/**
 * The version specifier for declaring a local workspace project as a
 * dependency. pnpm, bun and yarn berry support the `workspace:` protocol;
 * npm and yarn classic do not (npm fails the install with
 * EUNSUPPORTEDPROTOCOL, yarn classic tries the registry), so they receive
 * `*`, which both resolve to the workspace-local package.
 */
export const getLocalDependencySpecifier = (tree: Tree): string => {
  const packageManager = detectWorkspacePackageManager(tree);
  if (packageManager === 'npm') {
    return '*';
  }
  if (packageManager === 'yarn') {
    let major = 2;
    try {
      major = Number.parseInt(
        getPackageManagerVersion('yarn', tree.root).split('.')[0],
        10,
      );
    } catch {
      // Yarn not installed (e.g. in tests) — assume berry, matching the
      // modern-version assumption for catalog support.
    }
    if (major < 2) {
      return '*';
    }
  }
  return 'workspace:*';
};

/**
 * Whether the workspace's package manager supports dependency catalogs.
 */
export const supportsCatalogs = (tree: Tree): boolean => {
  const packageManager = detectWorkspacePackageManager(tree);
  const cacheKey = `${tree.root}|${packageManager}`;
  const cached = catalogSupportCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const minimumVersion = CATALOG_SUPPORT[packageManager];
  let supported = false;
  if (minimumVersion) {
    try {
      supported = versionAtLeast(
        getPackageManagerVersion(packageManager, tree.root),
        minimumVersion,
      );
    } catch {
      // Package manager not installed (e.g. in tests) — assume a modern
      // version since the workspace was created with it.
      supported = true;
    }
  }
  catalogSupportCache.set(cacheKey, supported);
  return supported;
};

/**
 * Whether generators should record dependency versions in the package
 * manager's catalog. True when the package manager supports catalogs (see
 * `supportsCatalogs`) and the workspace hasn't opted out via
 * `packageManager.catalogs: false` in `aws-nx-plugin.config.mts`. When
 * disabled, generators write direct version ranges to each project's
 * package.json and keeping versions aligned is the user's responsibility.
 */
export const catalogsEnabled = (tree: Tree): boolean => {
  if (!supportsCatalogs(tree)) {
    return false;
  }
  const config = readAwsNxPluginConfigSync(tree);
  return config?.packageManager?.catalogs !== false;
};

/**
 * Add dependencies to a package.json, routing version ranges through the
 * package manager's dependency catalog when supported.
 *
 * Drop-in replacement for devkit's `addDependenciesToPackageJson`. When
 * catalogs are enabled (see `catalogsEnabled`) on pnpm/yarn/bun, each entry
 * is written as a `catalog:` reference with the version range recorded in
 * the workspace catalog (pnpm-workspace.yaml, .yarnrc.yml, or the root
 * package.json `catalog` field). On npm, or when catalogs are disabled,
 * direct version ranges are written as-is.
 *
 * Generators declare a project's runtime dependencies against the project's
 * manifest (so `noUndeclaredDependencies` passes) and shared build/test
 * tooling against the root in a separate call. When `packageJsonPath` points
 * at a project without its own package.json, the dependencies fall back to
 * the workspace root.
 */
export const addDependenciesToPackageJson = (
  tree: Tree,
  dependencies: Record<string, string>,
  devDependencies: Record<string, string>,
  packageJsonPath = 'package.json',
): GeneratorCallback => {
  // A project without its own manifest declares dependencies at the root.
  const targetPath = tree.exists(packageJsonPath)
    ? packageJsonPath
    : 'package.json';

  // Devkit owns the update semantics (existing-version comparison, dev/prod
  // precedence, and routing entries that already use `catalog:` refs through
  // its own pnpm/yarn catalog managers).
  const callback = devkitAddDependenciesToPackageJson(
    tree,
    dependencies,
    devDependencies,
    targetPath,
  );

  if (catalogsEnabled(tree)) {
    convertDependenciesToCatalog(tree, targetPath, [
      ...Object.keys(dependencies),
      ...Object.keys(devDependencies),
    ]);
  }

  return callback;
};

/**
 * Packages whose declared version Nx generators read from the root manifest
 * via devkit's `getDependencyVersionFromPackageJson` and then coerce without
 * a null guard (`@nx/vitest`/`@nx/vite` read `vite`, `@nx/react` reads
 * `react`). Devkit resolves `catalog:` references through its catalog
 * managers, but Nx ships none for bun — the unresolved `catalog:` string
 * crashes those generators with `Cannot read properties of null (reading
 * 'version')`. On bun these packages keep direct version ranges until Nx
 * ships a bun catalog manager (`react-dom` is kept alongside `react` so the
 * pair can't drift apart).
 */
const BUN_INTROSPECTED_PACKAGES = new Set<string>([
  'vite',
  'react',
  'react-dom',
]);

/**
 * Whether a package must keep a direct version range (never `catalog:`) for
 * the workspace's package manager.
 */
const isCatalogExcluded = (tree: Tree, packageName: string): boolean =>
  detectWorkspacePackageManager(tree) === 'bun' &&
  BUN_INTROSPECTED_PACKAGES.has(packageName);

/**
 * Convert direct version ranges in the given package.json to `catalog:`
 * references, recording the range in the workspace's catalog. Entries already
 * using `catalog:`, `workspace:` or other protocol specifiers are left
 * untouched (devkit keeps their catalog versions up to date for pnpm/yarn;
 * for bun the catalog entry is backfilled when missing). The catalog itself is
 * always workspace-level regardless of which manifest declares the dependency.
 *
 * When a project manifest is targeted, any direct range for the same package
 * in the root manifest is converted too — Nx generators (`@nx/js` init,
 * `@nx/react`) write direct root entries like `@types/node: ^22.0.0` or
 * `react: ^19.0.0`, which would otherwise resolve to a second copy alongside
 * the catalog version, breaking the single version policy.
 */
const convertDependenciesToCatalog = (
  tree: Tree,
  packageJsonPath: string,
  packageNames: string[],
): void => {
  const catalogUpdates: Record<string, string> = {};

  updateJson(tree, packageJsonPath, (json) => {
    for (const field of ['dependencies', 'devDependencies'] as const) {
      for (const packageName of packageNames) {
        const version = json[field]?.[packageName];
        if (
          !version ||
          version.includes(':') ||
          isCatalogExcluded(tree, packageName)
        ) {
          continue;
        }
        catalogUpdates[packageName] = version;
        json[field][packageName] = 'catalog:';
      }
    }
    return json;
  });

  if (Object.keys(catalogUpdates).length > 0) {
    writeCatalogVersions(tree, catalogUpdates);
  }

  if (packageJsonPath !== 'package.json') {
    // Upgrade-only catalog writes make this safe in any order: whichever
    // manifest carries the higher version determines the catalog entry.
    convertDependenciesToCatalog(tree, 'package.json', packageNames);
  }
};

/**
 * Record version ranges in the default catalog, creating the catalog
 * definition when absent. An existing catalog entry is only replaced when the
 * incoming version is a strict upgrade (see `isVersionUpgrade`) — a version
 * the user has raised in the catalog is never downgraded by generating
 * another project.
 */
const writeCatalogVersions = (
  tree: Tree,
  updates: Record<string, string>,
): void => {
  const applyUpdates = (
    catalog: Record<string, string> | undefined,
  ): Record<string, string> | undefined => {
    const existing = catalog ?? {};
    const applicable = Object.fromEntries(
      Object.entries(updates).filter(
        ([name, version]) =>
          existing[name] === undefined ||
          isVersionUpgrade(version, existing[name]),
      ),
    );
    if (Object.keys(applicable).length === 0) {
      return undefined;
    }
    return { ...existing, ...applicable };
  };

  switch (detectWorkspacePackageManager(tree)) {
    case 'pnpm': {
      const workspaceYaml =
        (yaml.load(tree.read('pnpm-workspace.yaml', 'utf-8') ?? '') as Record<
          string,
          unknown
        >) ?? {};
      const catalog = applyUpdates(
        workspaceYaml.catalog as Record<string, string> | undefined,
      );
      if (catalog) {
        tree.write(
          'pnpm-workspace.yaml',
          yaml.dump({ ...workspaceYaml, catalog }, { quotingType: "'" }),
        );
      }
      break;
    }
    case 'yarn': {
      const yarnRc =
        (yaml.load(tree.read('.yarnrc.yml', 'utf-8') ?? '') as Record<
          string,
          unknown
        >) ?? {};
      const catalog = applyUpdates(
        yarnRc.catalog as Record<string, string> | undefined,
      );
      if (catalog) {
        tree.write(
          '.yarnrc.yml',
          yaml.dump({ ...yarnRc, catalog }, { quotingType: "'" }),
        );
      }
      break;
    }
    case 'bun': {
      const catalog = applyUpdates(
        readJson<{ catalog?: Record<string, string> }>(tree, 'package.json')
          .catalog,
      );
      if (catalog) {
        updateJson(tree, 'package.json', (json) => ({ ...json, catalog }));
      }
      break;
    }
  }
};
