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
  writeJson,
} from '@nx/devkit';
import yaml from 'js-yaml';
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
 * Parse a version or simple range (an optional `^`/`~`/`>=` prefix followed by
 * x.y.z and an optional prerelease suffix) into numeric parts. Returns
 * undefined for anything else (tags, protocols, compound ranges) — the whole
 * string must match, so ranges like `>=3 <5` or `^1 || ^2` are treated as
 * user-customised and never overwritten.
 */
const parseVersionParts = (version: string): number[] | undefined => {
  const match =
    /^(?:\^|~|>=)?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-[0-9A-Za-z.-]+)?$/.exec(
      version.trim(),
    );
  if (!match) {
    return undefined;
  }
  return [
    Number.parseInt(match[1], 10),
    match[2] ? Number.parseInt(match[2], 10) : 0,
    match[3] ? Number.parseInt(match[3], 10) : 0,
  ];
};

const compareVersions = (left: number[], right: number[]): number => {
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) {
      return left[i] - right[i];
    }
  }
  return 0;
};

const versionAtLeast = (version: string, minimum: string): boolean => {
  const parsed = parseVersionParts(version) ?? [0, 0, 0];
  const minimumParsed = parseVersionParts(minimum) ?? [0, 0, 0];
  return compareVersions(parsed, minimumParsed) >= 0;
};

/**
 * Whether `incoming` should replace `existing` as a catalog version. Mirrors
 * devkit's incumbent-wins semantics for manifest ranges: only a strictly
 * greater version replaces the existing entry, so generating a new project
 * never downgrades a version the user has upgraded in the catalog (which
 * would silently apply to every project referencing it). An existing entry
 * that can't be compared (a tag or complex range, i.e. user-customised) is
 * always kept.
 */
const isVersionUpgrade = (incoming: string, existing: string): boolean => {
  const existingParsed = parseVersionParts(existing);
  if (!existingParsed) {
    return false;
  }
  const incomingParsed = parseVersionParts(incoming);
  if (!incomingParsed) {
    return false;
  }
  return compareVersions(incomingParsed, existingParsed) > 0;
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
 * Build/test tooling that is only ever imported from config files, build
 * scripts, or the Nx toolchain — never from a project's runtime `src` code.
 * These always belong in the workspace root `package.json` devDependencies,
 * even when a generator adds them alongside a project's runtime dependencies.
 *
 * Everything not listed here (including `@types/*`, which back runtime
 * `import type` statements, and libraries like `aws-cdk-lib`, `constructs`,
 * `@prisma/client`, `@nx/devkit`) is treated as a project dependency and lands
 * in the owning project's manifest so that Biome's `noUndeclaredDependencies`
 * rule passes for the project's source.
 */
const ROOT_DEV_TOOLING = new Set<string>([
  // Test / coverage
  'vitest',
  '@vitest/coverage-v8',
  '@vitest/ui',
  'jsdom',
  // Bundlers / build
  'vite',
  '@tailwindcss/vite',
  'rolldown',
  'esbuild',
  'tsx',
  // TanStack build-time plugins
  '@tanstack/router-plugin',
  '@tanstack/router-generator',
  '@tanstack/virtual-file-routes',
  '@tanstack/router-utils',
  // Nx toolchain
  'nx',
  '@nx/js',
  '@nx/workspace',
  '@nx/react',
  '@nxlv/python',
  '@nx-extend/terraform',
  // Language / format / ORM CLIs
  'typescript',
  '@biomejs/biome',
  'prisma',
  // CDK CLI (the `aws-cdk` CLI, not the `aws-cdk-lib` library)
  'aws-cdk',
  // Filesystem / shell build helpers
  'ncp',
  'rimraf',
  'make-dir-cli',
  'husky',
  // Inspectors / dev harnesses
  '@modelcontextprotocol/inspector',
]);

const isRootDevTooling = (packageName: string): boolean =>
  ROOT_DEV_TOOLING.has(packageName);

const pick = (
  deps: Record<string, string>,
  predicate: (name: string) => boolean,
): Record<string, string> =>
  Object.fromEntries(Object.entries(deps).filter(([name]) => predicate(name)));

/**
 * Add dependencies to a package.json, routing version ranges through the
 * package manager's dependency catalog when supported.
 *
 * This is a drop-in replacement for `addDependenciesToPackageJson` from
 * `@nx/devkit` and generators use it for all dependency additions. When
 * catalogs are enabled (see `catalogsEnabled`) on pnpm/yarn/bun, each entry is
 * written as a `catalog:` reference with the version range recorded in the
 * package manager's catalog (pnpm-workspace.yaml, .yarnrc.yml, or the root
 * package.json `catalog` field respectively), so the catalog remains the
 * single source of truth for dependency versions across the workspace. On
 * npm — which has no catalog feature — or when the workspace opts out via
 * `packageManager.catalogs: false`, direct version ranges are written as-is
 * and keeping them aligned is the user's responsibility.
 *
 * When `packageJsonPath` targets a project's own manifest (not the workspace
 * root), the project's runtime dependencies are written there while pure
 * build/test tooling (see `ROOT_DEV_TOOLING`) is redirected to the workspace
 * root devDependencies. This keeps every project declaring the dependencies
 * its source imports — so `noUndeclaredDependencies` passes — while shared
 * tooling stays installed once at the root.
 */
export const addDependenciesToPackageJson = (
  tree: Tree,
  dependencies: Record<string, string>,
  devDependencies: Record<string, string>,
  packageJsonPath = 'package.json',
): GeneratorCallback => {
  const targetsProject = packageJsonPath !== 'package.json';

  // Devkit's `addDependenciesToPackageJson` reads the manifest and throws if
  // it's missing. A generator may add dependencies before the project's
  // package.json has been vended, so ensure a minimal one exists first.
  if (targetsProject && !tree.exists(packageJsonPath)) {
    writeJson(tree, packageJsonPath, {});
  }

  // For a project manifest, split off pure tooling to the root; everything
  // else (runtime deps, and the `@types/*` that back runtime type imports)
  // stays with the project. For the root manifest, write everything as-is.
  const rootDevDependencies = targetsProject
    ? {
        ...pick(dependencies, isRootDevTooling),
        ...pick(devDependencies, isRootDevTooling),
      }
    : {};
  const projectDependencies = targetsProject
    ? pick(dependencies, (n) => !isRootDevTooling(n))
    : dependencies;
  const projectDevDependencies = targetsProject
    ? pick(devDependencies, (n) => !isRootDevTooling(n))
    : devDependencies;

  // Devkit owns the update semantics (existing-version comparison, dev/prod
  // precedence, and routing entries that already use `catalog:` refs through
  // its own pnpm/yarn catalog managers).
  const callback = devkitAddDependenciesToPackageJson(
    tree,
    projectDependencies,
    projectDevDependencies,
    packageJsonPath,
  );
  if (Object.keys(rootDevDependencies).length > 0) {
    devkitAddDependenciesToPackageJson(tree, {}, rootDevDependencies);
  }

  if (catalogsEnabled(tree)) {
    convertDependenciesToCatalog(tree, packageJsonPath, [
      ...Object.keys(projectDependencies),
      ...Object.keys(projectDevDependencies),
    ]);
    if (Object.keys(rootDevDependencies).length > 0) {
      convertDependenciesToCatalog(
        tree,
        'package.json',
        Object.keys(rootDevDependencies),
      );
    }
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
