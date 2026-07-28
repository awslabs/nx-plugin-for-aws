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
import { readAwsNxPluginConfig } from './config/utils';

// Minimum version that introduced catalog support per package manager (npm has none).
const CATALOG_SUPPORT: Partial<Record<PackageManager, string>> = {
  pnpm: '9.5.0',
  yarn: '4.10.0',
  bun: '1.2.14',
};

// Prefer tree markers over devkit's `detectPackageManager`, which reads the
// real filesystem and is nondeterministic for virtual trees in tests.
export const detectWorkspacePackageManager = (tree: Tree): PackageManager =>
  tree.exists('pnpm-workspace.yaml') ? 'pnpm' : detectPackageManager(tree.root);

// Coerce a single simple range to a version. Rejects compound ranges
// (whitespace / `||`), which coerce would silently reduce, plus tags/protocols.
const parseSimpleRange = (version: string) => {
  const trimmed = version.trim();
  if (/\s|\|\|/.test(trimmed)) {
    return undefined;
  }
  return coerce(trimmed, { includePrerelease: true }) ?? undefined;
};

const versionAtLeast = (version: string, minimum: string): boolean =>
  gte(
    parseSimpleRange(version) ?? '0.0.0',
    parseSimpleRange(minimum) ?? '0.0.0',
  );

// Only a strict upgrade replaces an existing catalog entry, so generating a
// project never downgrades a version the user raised. Uncomparable entries
// (tags, complex ranges) are kept.
const isVersionUpgrade = (incoming: string, existing: string): boolean => {
  const existingParsed = parseSimpleRange(existing);
  const incomingParsed = parseSimpleRange(incoming);
  if (!existingParsed || !incomingParsed) {
    return false;
  }
  return gt(incomingParsed, existingParsed);
};

// Keyed by root + package manager; detecting support shells out for a version.
const catalogSupportCache = new Map<string, boolean>();

/** Clears the catalog support cache. Only needed by tests. */
export const resetCatalogSupportCache = (): void => {
  catalogSupportCache.clear();
};

// Local-project specifier: the `workspace:` protocol where supported (pnpm,
// bun, yarn berry), `*` on npm and yarn classic which reject it.
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
      // Not installed (e.g. tests) — assume berry.
    }
    if (major < 2) {
      return '*';
    }
  }
  return 'workspace:*';
};

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
      // Not installed (e.g. tests) — assume a modern version.
      supported = true;
    }
  }
  catalogSupportCache.set(cacheKey, supported);
  return supported;
};

// True when the package manager supports catalogs and the workspace hasn't
// opted out via `packageManager.catalogs: false` in aws-nx-plugin.config.mts.
export const catalogsEnabled = (tree: Tree): boolean => {
  if (!supportsCatalogs(tree)) {
    return false;
  }
  const config = readAwsNxPluginConfig(tree);
  return config?.packageManager?.catalogs !== false;
};

/**
 * Drop-in replacement for devkit's `addDependenciesToPackageJson` that records
 * versions in the package manager's catalog when enabled. Callers pass a
 * project manifest path for runtime deps (so `noUndeclaredDependencies` passes)
 * and the root for shared tooling.
 */
export const addDependenciesToPackageJson = (
  tree: Tree,
  dependencies: Record<string, string>,
  devDependencies: Record<string, string>,
  packageJsonPath = 'package.json',
): GeneratorCallback => {
  const callback = devkitAddDependenciesToPackageJson(
    tree,
    dependencies,
    devDependencies,
    packageJsonPath,
  );

  if (catalogsEnabled(tree)) {
    const packageNames = [
      ...Object.keys(dependencies),
      ...Object.keys(devDependencies),
    ];
    convertDependenciesToCatalog(tree, packageJsonPath, packageNames);
    // Convert any matching root ranges Nx wrote behind our back (e.g.
    // `@types/node`, `react`) so they don't resolve to a second copy alongside
    // the catalog version. Skipped when the caller already targeted the root.
    if (packageJsonPath !== 'package.json') {
      convertDependenciesToCatalog(tree, 'package.json', packageNames);
    }
  }

  return callback;
};

// Nx generators read these versions from the root manifest and coerce without
// a null guard; Nx ships no bun catalog manager, so an unresolved `catalog:`
// crashes them. Keep direct ranges on bun (react-dom pinned with react).
const BUN_INTROSPECTED_PACKAGES = new Set<string>([
  'vite',
  'react',
  'react-dom',
]);

const isCatalogExcluded = (tree: Tree, packageName: string): boolean =>
  detectWorkspacePackageManager(tree) === 'bun' &&
  BUN_INTROSPECTED_PACKAGES.has(packageName);

// Convert direct version ranges to `catalog:` references in a single manifest
// and record the range in the workspace catalog. Protocol specifiers
// (catalog:/workspace:/...) are left alone.
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
          version &&
          !version.includes(':') &&
          !isCatalogExcluded(tree, packageName)
        ) {
          catalogUpdates[packageName] = version;
          json[field][packageName] = 'catalog:';
        }
      }
    }
    return json;
  });

  if (Object.keys(catalogUpdates).length > 0) {
    writeCatalogVersions(tree, catalogUpdates);
  }
};

// Record ranges in the default catalog, creating it if absent. Only strict
// upgrades replace existing entries (see `isVersionUpgrade`).
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
