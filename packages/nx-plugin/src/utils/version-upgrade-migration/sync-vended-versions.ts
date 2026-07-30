/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  type MigrationReturnObject,
  readJson,
  type Tree,
  updateJson,
  visitNotIgnoredFiles,
} from '@nx/devkit';
import yaml from 'js-yaml';
import { getCatalogManager } from 'nx/src/utils/catalog';
import { parsePipRequirementsLine } from 'pip-requirements-js';
import { parse, satisfies, validRange } from 'semver';
import { applyGritQL, captureAllGritQL } from '../ast';
import { formatFilesInSubtree } from '../format';
import { updateToml } from '../toml';
import { PY_VERSIONS, TERRAFORM_VERSIONS, TS_VERSIONS } from '../versions';
import { isNxPackage } from './nx-package-updates';
import {
  type OwnedDependencies,
  ownedDependencies,
} from './owned-dependencies';
import { syncMetricsVersion } from './sync-metrics-version';
import { isVendedUpgrade } from './vended-upgrade';

/**
 * Syncs the versions a generated workspace pins to those this release vends:
 * TypeScript dependencies, Python pins, Terraform providers, and the plugin
 * version the metrics files report.
 *
 * nx and `@nx/*` are excluded — `packageJsonUpdates` owns them so `nx migrate`
 * collects Nx's own migrations (see `nx-package-updates.ts`).
 */

const YAML_CATALOG_FILES = ['pnpm-workspace.yaml', '.yarnrc.yml'];

/**
 * Vended version for a dependency this workspace's generators own, or undefined
 * for one the user added themselves.
 */
const vendedTsVersion = (
  owned: OwnedDependencies,
  name: string,
): string | undefined =>
  isNxPackage(name) || !owned.ts.has(name)
    ? undefined
    : TS_VERSIONS[name as keyof typeof TS_VERSIONS];

/** PY_VERSIONS records the `==` operator; the pin holds the bare version. */
const vendedPyVersion = (
  owned: OwnedDependencies,
  name: string,
): string | undefined =>
  owned.py.has(name)
    ? PY_VERSIONS[name as keyof typeof PY_VERSIONS]?.replace(/^==/, '')
    : undefined;

/** Protocols whose version lives elsewhere, and is synced there instead. */
const REFERENCE_PROTOCOL =
  /^(?:workspace|file|link|npm|git|git\+|github|portal|patch|exec):/;

/**
 * Whether devkit may be handed this specifier.
 *
 * `catalog:` is only safe where devkit has a catalog manager (pnpm, yarn).
 * It ships none for bun, and without one it rewrites the reference to a literal
 * version, severing the catalog — so bun's references are synced directly.
 */
const isSyncableSpecifier = (tree: Tree, declared: string): boolean => {
  if (REFERENCE_PROTOCOL.test(declared)) {
    return false;
  }
  return (
    !declared.startsWith('catalog:') || getCatalogManager(tree.root) !== null
  );
};

/**
 * Whether the declared range already permits the vended version, following a
 * `catalog:` reference to the range it points at.
 *
 * Devkit would narrow such a range to an exact pin, discarding a user's widened
 * specifier without changing what resolves, so it is left alone.
 */
const alreadyPermitsVended = (
  tree: Tree,
  packageName: string,
  declared: string,
  vended: string,
): boolean => {
  let range = declared;
  if (declared.startsWith('catalog:')) {
    const resolved = getCatalogManager(tree.root)?.resolveCatalogReference(
      tree,
      packageName,
      declared,
    );
    if (!resolved) {
      return false;
    }
    range = resolved;
  }
  range = range.trim();
  // An exact pin is the case to upgrade, not a range to preserve.
  if (parse(range) !== null || validRange(range) === null) {
    return false;
  }
  return satisfies(vended, range);
};

/**
 * Vended packages a manifest already declares, and the version to move each to.
 *
 * Only packages already present are named: devkit adds whatever it is given, so
 * passing the full vended list would inject all of it into every manifest.
 */
const declaredVendedPackages = (
  tree: Tree,
  owned: OwnedDependencies,
  packageJsonPath: string,
): {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
} => {
  const json = readJson(tree, packageJsonPath);
  const pick = (field: 'dependencies' | 'devDependencies') =>
    Object.fromEntries(
      Object.entries((json[field] ?? {}) as Record<string, string>).flatMap(
        ([name, declared]) => {
          const vended = vendedTsVersion(owned, name);
          return vended &&
            isSyncableSpecifier(tree, declared) &&
            !alreadyPermitsVended(tree, name, declared, vended)
            ? [[name, vended] as const]
            : [];
        },
      ),
    );
  return {
    dependencies: pick('dependencies'),
    devDependencies: pick('devDependencies'),
  };
};

/**
 * Sync the TypeScript dependencies every `package.json` declares.
 *
 * Devkit does the writing: it moves a version wherever the workspace keeps it —
 * through a `catalog:` reference or directly — and refuses anything that isn't a
 * strict upgrade on what is installed.
 *
 * Called directly rather than through this plugin's wrapper, which *migrates*
 * declarations into the catalog; right when generating, wrong for a version bump.
 */
const syncPackageJsons = (tree: Tree, owned: OwnedDependencies): string[] => {
  const updated: string[] = [];

  visitNotIgnoredFiles(tree, '.', (path) => {
    if (!path.endsWith('package.json')) {
      return;
    }
    const { dependencies, devDependencies } = declaredVendedPackages(
      tree,
      owned,
      path,
    );
    if (
      Object.keys(dependencies).length === 0 &&
      Object.keys(devDependencies).length === 0
    ) {
      return;
    }

    const before = tree.read(path, 'utf-8');
    const catalogsBefore = readCatalogFiles(tree);
    // Install callback dropped: `nx migrate` runs install itself.
    addDependenciesToPackageJson(tree, dependencies, devDependencies, path);
    if (
      tree.read(path, 'utf-8') !== before ||
      readCatalogFiles(tree) !== catalogsBefore
    ) {
      updated.push(path);
    }
  });

  return updated;
};

/** Snapshot of every catalog definition file, for change detection. */
const readCatalogFiles = (tree: Tree): string =>
  [...YAML_CATALOG_FILES, 'package.json']
    .map((path) => (tree.exists(path) ? tree.read(path, 'utf-8') : ''))
    .join('\0');

/**
 * Upgrade vended catalog entries devkit cannot reach: those no manifest
 * references, and every bun entry (bun has no catalog manager).
 */
const syncOrphanCatalogEntries = (
  tree: Tree,
  owned: OwnedDependencies,
): string[] => {
  const referenced = referencedCatalogPackages(tree);
  const updated: string[] = [];

  const syncCatalog = (
    catalog: Record<string, string> | undefined,
  ): boolean => {
    let changed = false;
    for (const [name, declared] of Object.entries(catalog ?? {})) {
      const vended = vendedTsVersion(owned, name);
      if (!vended || referenced.has(name)) {
        continue;
      }
      if (isVendedUpgrade(vended, String(declared))) {
        catalog![name] = vended;
        changed = true;
      }
    }
    return changed;
  };

  for (const path of YAML_CATALOG_FILES) {
    if (!tree.exists(path)) {
      continue;
    }
    const catalogFile = (yaml.load(tree.read(path, 'utf-8') ?? '') ?? {}) as {
      catalog?: Record<string, string>;
      catalogs?: Record<string, Record<string, string>>;
    };
    const changed = [
      syncCatalog(catalogFile.catalog),
      ...Object.values(catalogFile.catalogs ?? {}).map(syncCatalog),
    ].some(Boolean);
    if (changed) {
      tree.write(path, yaml.dump(catalogFile, { quotingType: "'" }));
      updated.push(path);
    }
  }

  // Bun keeps its catalogs in the root manifest.
  if (tree.exists('package.json')) {
    let changed = false;
    updateJson(tree, 'package.json', (json) => {
      changed = [
        syncCatalog(json.catalog),
        ...Object.values(
          (json.catalogs ?? {}) as Record<string, Record<string, string>>,
        ).map(syncCatalog),
      ].some(Boolean);
      return json;
    });
    if (changed) {
      updated.push('package.json');
    }
  }

  return updated;
};

/**
 * Packages devkit already maintains through a `catalog:` reference. Empty
 * without a catalog manager, where no reference resolves.
 */
const referencedCatalogPackages = (tree: Tree): Set<string> => {
  const referenced = new Set<string>();
  if (getCatalogManager(tree.root) === null) {
    return referenced;
  }
  visitNotIgnoredFiles(tree, '.', (path) => {
    if (!path.endsWith('package.json')) {
      return;
    }
    const json = readJson(tree, path);
    for (const field of ['dependencies', 'devDependencies'] as const) {
      for (const [name, declared] of Object.entries(
        (json[field] ?? {}) as Record<string, string>,
      )) {
        if (String(declared).startsWith('catalog:')) {
          referenced.add(name);
        }
      }
    }
  });
  return referenced;
};

/**
 * Upgrade a pip requirement to the vended version, or return it unchanged.
 *
 * Parsed rather than pattern-matched so extras and operators are read the way
 * `uv` reads them. Only a single `==` pin is rewritten; anything looser is the
 * user's choice.
 */
const syncPyRequirement = (
  owned: OwnedDependencies,
  requirement: string,
): string => {
  const parsed = parsePipRequirementsLine(requirement);
  if (parsed?.type !== 'ProjectName' || parsed.versionSpec?.length !== 1) {
    return requirement;
  }
  const [spec] = parsed.versionSpec;
  if (spec.operator !== '==') {
    return requirement;
  }

  const name = parsed.extras?.length
    ? `${parsed.name}[${parsed.extras.join(',')}]`
    : parsed.name;
  const vended = vendedPyVersion(owned, name);
  if (!vended || !isVendedUpgrade(vended, spec.version)) {
    return requirement;
  }
  return `${name}==${vended}`;
};

/** Sync pins in every `pyproject.toml`, dependencies and groups alike. */
const syncPyProjects = (tree: Tree, owned: OwnedDependencies): string[] => {
  const updated: string[] = [];

  visitNotIgnoredFiles(tree, '.', (path) => {
    if (!path.endsWith('pyproject.toml')) {
      return;
    }

    let changed = false;
    const syncRequirements = (requirements: unknown): unknown =>
      Array.isArray(requirements)
        ? requirements.map((requirement) => {
            if (typeof requirement !== 'string') {
              return requirement;
            }
            const synced = syncPyRequirement(owned, requirement);
            changed ||= synced !== requirement;
            return synced;
          })
        : requirements;

    updateToml(tree, path, (toml) => {
      const project = toml.project as Record<string, unknown> | undefined;
      if (project?.dependencies) {
        project.dependencies = syncRequirements(project.dependencies) as never;
      }
      const groups = toml['dependency-groups'] as
        | Record<string, unknown>
        | undefined;
      for (const group of Object.keys(groups ?? {})) {
        groups![group] = syncRequirements(groups![group]) as never;
      }
      return toml;
    });

    if (changed) {
      updated.push(path);
    }
  });

  return updated;
};

/**
 * GritQL matching one provider's `version` in `required_providers`, scoped by
 * the sibling `source` so an alias or another provider's version can't match.
 *
 * `language hcl` is required — without it the pattern silently matches nothing.
 */
const providerVersionPattern = (provider: string, rewrite = ''): string =>
  `language hcl\n\`version = $version\`${rewrite} where {` +
  ` $version <: within \`{ source = "hashicorp/${provider}" $... }\` }`;

/** Version a provider currently declares, if it declares one. */
const declaredProviderVersion = async (
  tree: Tree,
  path: string,
  provider: string,
): Promise<string | undefined> => {
  const [captured] = await captureAllGritQL(
    tree,
    path,
    providerVersionPattern(provider),
  );
  // The match is the whole attribute, e.g. `version = "6.40.0"`.
  return /"([^"]+)"/.exec(captured ?? '')?.[1];
};

/** Sync vended provider versions in every `.tf` file. */
const syncTerraformProviders = async (tree: Tree): Promise<string[]> => {
  const updated: string[] = [];
  const terraformFiles: string[] = [];

  visitNotIgnoredFiles(tree, '.', (path) => {
    if (path.endsWith('.tf')) {
      terraformFiles.push(path);
    }
  });

  for (const path of terraformFiles) {
    let changed = false;
    for (const [provider, vended] of Object.entries(TERRAFORM_VERSIONS)) {
      const declared = await declaredProviderVersion(tree, path, provider);
      if (!declared || !isVendedUpgrade(vended, declared)) {
        continue;
      }
      changed =
        (await applyGritQL(
          tree,
          path,
          providerVersionPattern(provider, ` => \`version = "${vended}"\``),
        )) || changed;
    }
    if (changed) {
      updated.push(path);
    }
  }

  return updated;
};

/**
 * Sync the versions this release vends, for the dependencies the workspace's
 * generators own.
 */
export const syncVendedVersions = async (
  tree: Tree,
): Promise<MigrationReturnObject> => {
  const nextSteps: string[] = [];
  const owned = await ownedDependencies(tree);

  const packageJsons = syncPackageJsons(tree, owned);
  const catalogs = syncOrphanCatalogEntries(tree, owned);
  const pyProjects = syncPyProjects(tree, owned);
  const terraformFiles = await syncTerraformProviders(tree);
  await syncMetricsVersion(tree);

  // Lock files are left to the user: `nx migrate` only installs when the root
  // manifest changes, and never runs `uv` or `terraform`.
  if (catalogs.length > 0 || packageJsons.length > 0) {
    nextSteps.push(
      'TypeScript dependency versions were updated. Run your package manager install to update the lock file.',
    );
  }
  if (pyProjects.length > 0) {
    nextSteps.push(
      `Python dependency versions were updated in ${pyProjects.join(', ')}. Run \`uv sync\` to update uv.lock.`,
    );
  }
  if (terraformFiles.length > 0) {
    nextSteps.push(
      `Terraform provider versions were updated in ${terraformFiles.length} file(s). Run \`terraform init -upgrade\` in each Terraform project to update its lock file.`,
    );
  }

  // Without this the workspace's own format check fails on the migrated files.
  await formatFilesInSubtree(tree);

  return { nextSteps };
};
