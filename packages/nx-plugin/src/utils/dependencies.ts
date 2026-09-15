/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  detectPackageManager,
  addDependenciesToPackageJson as devkitAddDependenciesToPackageJson,
  removeDependenciesFromPackageJson as devkitRemoveDependenciesFromPackageJson,
  type GeneratorCallback,
  getPackageManagerVersion,
  getProjects,
  joinPathFragments,
  type PackageManager,
  readJson,
  type Tree,
  updateJson,
} from '@nx/devkit';
import yaml from 'js-yaml';
import { coerce, gt, gte } from 'semver';
import { readAwsNxPluginConfig } from './config/utils.js';

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

/**
 * Drop-in replacement for devkit's `removeDependenciesFromPackageJson` that
 * also drops the package manager's catalog entry, which devkit leaves behind
 * pointing at a package nothing declares any more.
 *
 * The entry is only dropped once no manifest in the workspace declares the
 * package, so removing it from one project leaves another project's reference
 * resolvable.
 */
export const removeDependenciesFromPackageJson = (
  tree: Tree,
  dependencies: string[],
  devDependencies: string[],
  packageJsonPath = 'package.json',
): GeneratorCallback => {
  const callback = devkitRemoveDependenciesFromPackageJson(
    tree,
    dependencies,
    devDependencies,
    packageJsonPath,
  );

  if (catalogsEnabled(tree)) {
    const manifests = workspaceManifests(tree, packageJsonPath);
    const removed = [...new Set([...dependencies, ...devDependencies])].filter(
      (packageName) =>
        !manifests.some((manifest) =>
          MANIFEST_DEPENDENCY_FIELDS.some(
            (field) => manifest[field]?.[packageName] !== undefined,
          ),
        ),
    );
    removeCatalogVersions(tree, removed);
  }

  return callback;
};

type Manifest = Record<string, Record<string, string> | undefined>;

/**
 * Every manifest that can hold a catalog reference: the root, each project's,
 * and the one just written. Project manifests come from the project graph
 * rather than a tree walk, so a manifest belonging to no project is not seen.
 */
const workspaceManifests = (tree: Tree, packageJsonPath: string): Manifest[] =>
  [
    ...new Set([
      'package.json',
      packageJsonPath,
      ...Array.from(getProjects(tree).values()).map((project) =>
        joinPathFragments(project.root, 'package.json'),
      ),
    ]),
  ]
    .filter((path) => tree.exists(path))
    .map((path) => readJson<Manifest>(tree, path));

const MANIFEST_DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

// Drop entries from the default catalog, mirroring `writeCatalogVersions`.
const removeCatalogVersions = (tree: Tree, packageNames: string[]): void => {
  if (packageNames.length === 0) {
    return;
  }

  const withoutRemoved = (
    catalog: Record<string, string> | undefined,
  ): Record<string, string> | undefined => {
    if (!catalog || !packageNames.some((name) => name in catalog)) {
      return undefined;
    }
    return Object.fromEntries(
      Object.entries(catalog).filter(([name]) => !packageNames.includes(name)),
    );
  };

  switch (detectWorkspacePackageManager(tree)) {
    case 'pnpm': {
      const workspaceYaml =
        (yaml.load(tree.read('pnpm-workspace.yaml', 'utf-8') ?? '') as Record<
          string,
          unknown
        >) ?? {};
      const catalog = withoutRemoved(
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
      const catalog = withoutRemoved(
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
      const catalog = withoutRemoved(
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
        if (version && !version.includes(':')) {
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
