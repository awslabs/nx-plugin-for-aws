/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  detectPackageManager,
  type MigrationReturnObject,
  readJson,
  type Tree,
  updateJson,
  visitNotIgnoredFiles,
} from '@nx/devkit';
import yaml from 'js-yaml';
import { getCatalogManager } from 'nx/src/utils/catalog';
import { parsePipRequirementsLine } from 'pip-requirements-js';
import { coerce, parse, satisfies, validRange } from 'semver';
import { applyGritQL, captureAllGritQL } from '../ast.js';
import { buildInstallCommand } from '../commands.js';
import { formatFilesInSubtree } from '../format.js';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../shared-constructs-constants.js';
import { updateToml } from '../toml.js';
import {
  cdkLambdaRuntime,
  type ILambdaRuntime,
  LAMBDA_RUNTIME_VERSIONS,
  PY_VERSIONS,
  pyenvPythonVersion,
  pyprojectPythonDependency,
  TERRAFORM_VERSIONS,
  TS_VERSIONS,
  terraformLambdaRuntime,
} from '../versions.js';
import { isNxPackage } from './nx-package-updates.js';
import {
  type OwnedDependencies,
  ownedDependencies,
} from './owned-dependencies.js';
import { syncEmbeddedVersions } from './sync-embedded-versions.js';
import { syncMetricsVersion } from './sync-metrics-version.js';
import { isVendedUpgrade } from './vended-upgrade.js';

/**
 * Syncs the versions a generated workspace pins to those this release vends:
 * TypeScript dependencies (including those pinned only by an override), Python
 * pins, Terraform providers, and the plugin version the metrics files report.
 *
 * nx and `@nx/*` are excluded — `packageJsonUpdates` owns them so `nx migrate`
 * collects Nx's own migrations (see `nx-package-updates.ts`).
 */

/** Workspace files holding catalog definitions, and pnpm 11's overrides. */
const YAML_WORKSPACE_FILES = ['pnpm-workspace.yaml', '.yarnrc.yml'];

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
const isSyncableSpecifier = (tree: Tree, declared: unknown): boolean => {
  // A manifest is the user's file and may hold anything. A version that isn't a
  // string is not one this can reason about, and throwing here would abort the
  // whole `nx migrate` over a file the sync only meant to skip.
  if (typeof declared !== 'string') {
    return false;
  }
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
  [...YAML_WORKSPACE_FILES, 'package.json']
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

  for (const path of YAML_WORKSPACE_FILES) {
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
 * The package an override key pins, or undefined when the key names none.
 *
 * A key is a package name, optionally preceded by the path it is scoped to and
 * followed by the parent range it applies at:
 *
 *   zod                                     -> zod
 *   zod@^3                                  -> zod
 *   **&#47;@modelcontextprotocol/sdk/zod        -> zod
 *   @prisma/adapter-pg/@types/pg            -> @types/pg
 *
 * The last segment is the package, since every earlier one is a parent it is
 * scoped under — except that a scope and the name after it are one segment.
 */
const overriddenPackage = (key: string): string | undefined => {
  const segments = key.split('/').reduce<string[]>((acc, part) => {
    // A bare `@scope` is only half a name; join it to what follows.
    const previous = acc[acc.length - 1];
    if (previous?.startsWith('@') && !previous.includes('/')) {
      acc[acc.length - 1] = `${previous}/${part}`;
      return acc;
    }
    acc.push(part);
    return acc;
  }, []);

  const name = segments[segments.length - 1];
  if (!name || name === '.') {
    return undefined;
  }
  // A trailing `@range` scopes the override to a parent version.
  const at = name.lastIndexOf('@');
  return at > 0 ? name.slice(0, at) : name;
};

/**
 * Sync the owned packages an override pins, wherever the workspace keeps them:
 * npm's `overrides`, yarn and bun's `resolutions`, and pnpm's `pnpm.overrides`
 * (10) or `pnpm-workspace.yaml` `overrides` (11).
 *
 * Devkit does not manage these fields, so an owned package pinned only here
 * would otherwise stay on the version it was generated with. Values are compared
 * with `isVendedUpgrade`, so a range the user widened is left alone.
 */
/**
 * Where the workspace's package manager reads overrides from.
 *
 * Only the root manifest is considered: every package manager resolves overrides
 * from the workspace root, so a nested `overrides` block is inert and rewriting
 * it would imply an effect it doesn't have.
 *
 * pnpm moved the block between majors — 10 reads `pnpm.overrides` in the
 * manifest, 11 reads `overrides` in `pnpm-workspace.yaml` — so both are covered
 * rather than detecting the minor.
 */
const overrideLocations = (
  tree: Tree,
): {
  manifestFields: readonly ('overrides' | 'resolutions' | 'pnpm.overrides')[];
  workspaceFile?: string;
} => {
  switch (detectPackageManager(tree.root)) {
    case 'npm':
      return { manifestFields: ['overrides'] };
    case 'yarn':
      return { manifestFields: ['resolutions'] };
    case 'bun':
      // Bun reads npm's `overrides` and yarn's `resolutions` alike.
      return { manifestFields: ['overrides', 'resolutions'] };
    default:
      return {
        manifestFields: ['pnpm.overrides'],
        workspaceFile: 'pnpm-workspace.yaml',
      };
  }
};

const syncOverrides = (tree: Tree, owned: OwnedDependencies): string[] => {
  const updated: string[] = [];

  // Nested npm overrides carry the pin under `.`, with sibling keys scoping
  // deeper, so a value may be a string or another override object.
  const syncOverrideTree = (overrides: unknown): boolean => {
    if (typeof overrides !== 'object' || overrides === null) {
      return false;
    }
    let changed = false;
    for (const [key, value] of Object.entries(
      overrides as Record<string, unknown>,
    )) {
      if (typeof value === 'object' && value !== null) {
        changed = syncOverrideTree(value) || changed;
        continue;
      }
      if (typeof value !== 'string') {
        continue;
      }
      // `.` pins the package its parent key names.
      const name =
        key === '.' ? undefined : (overriddenPackage(key) ?? undefined);
      const vended = name ? vendedTsVersion(owned, name) : undefined;
      if (vended && isVendedUpgrade(vended, value)) {
        (overrides as Record<string, unknown>)[key] = vended;
        changed = true;
      }
    }
    return changed;
  };

  const { manifestFields, workspaceFile } = overrideLocations(tree);

  if (manifestFields.length > 0) {
    let changed = false;
    updateJson(tree, 'package.json', (json) => {
      changed = manifestFields
        .map((field) =>
          syncOverrideTree(
            field === 'pnpm.overrides' ? json.pnpm?.overrides : json[field],
          ),
        )
        .some(Boolean);
      return json;
    });
    if (changed) {
      updated.push('package.json');
    }
  }

  if (workspaceFile && tree.exists(workspaceFile)) {
    const contents = (yaml.load(tree.read(workspaceFile, 'utf-8') ?? '') ??
      {}) as Record<string, unknown>;
    if (syncOverrideTree(contents.overrides)) {
      tree.write(workspaceFile, yaml.dump(contents, { quotingType: "'" }));
      updated.push(workspaceFile);
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

/** Pip specifier as `pip-requirements-js` reports it. */
interface PyVersionSpec {
  readonly operator: string;
  readonly version: string;
}

/**
 * Whether the declared specifiers already permit the vended version, so
 * rewriting them would discard the user's range without changing what resolves.
 *
 * This mirrors the TypeScript side: an exact pin is the case to upgrade, a range
 * that already reaches the vended version is left alone, and a range that falls
 * short is moved up.
 *
 * A `*` wildcard or a specifier semver can't read counts as already permitting,
 * so anything not understood is left as the user wrote it.
 */
const pyRangePermitsVended = (
  specs: readonly PyVersionSpec[],
  vended: string,
): boolean =>
  specs.every((spec) => {
    if (spec.version.includes('*')) {
      return true;
    }
    const bound = coerce(spec.version, { includePrerelease: true });
    if (!bound) {
      return true;
    }
    switch (spec.operator) {
      // An exact pin permits only itself, so a differing vended version is an
      // upgrade to apply.
      case '==':
      case '===':
        return satisfies(vended, `=${bound.version}`, {
          includePrerelease: true,
        });
      // `~=1.2.3` allows the patch series; `~=1.2` the minor series.
      case '~=':
        return satisfies(
          vended,
          spec.version.split('.').length > 2
            ? `~${bound.version}`
            : `^${bound.version}`,
          { includePrerelease: true },
        );
      case '>=':
      case '>':
      case '<=':
      case '<':
        return satisfies(vended, `${spec.operator}${bound.version}`, {
          includePrerelease: true,
        });
      // `!=` only excludes, so it never blocks the vended version by itself.
      case '!=':
        return true;
      default:
        return true;
    }
  });

/**
 * Upgrade a pip requirement to the vended version, or return it unchanged.
 *
 * Parsed rather than pattern-matched so extras and operators are read the way
 * `uv` reads them. A requirement whose specifiers already permit the vended
 * version keeps them; one that falls short is replaced with an exact pin, which
 * is what the generators write.
 */
const syncPyRequirement = (
  owned: OwnedDependencies,
  requirement: string,
): string => {
  const parsed = parsePipRequirementsLine(requirement);
  if (parsed?.type !== 'ProjectName' || !parsed.versionSpec?.length) {
    return requirement;
  }

  const name = parsed.extras?.length
    ? `${parsed.name}[${parsed.extras.join(',')}]`
    : parsed.name;
  const vended = vendedPyVersion(owned, name);
  if (!vended) {
    return requirement;
  }

  const specs = parsed.versionSpec as readonly PyVersionSpec[];
  // Never move a version backwards: a pin above what this release vends is the
  // user's, and a range already reaching it is theirs to keep.
  const [first] = specs;
  const isExactPin =
    specs.length === 1 && (first.operator === '==' || first.operator === '===');
  if (isExactPin && !isVendedUpgrade(vended, first.version)) {
    return requirement;
  }
  if (!isExactPin && pyRangePermitsVended(specs, vended)) {
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
 * The two projects this plugin generates infrastructure into, and the only place
 * a Lambda runtime is rewritten.
 *
 * A runtime is not a dependency, so there is no per-package ownership to consult
 * — the scope has to be the directories the plugin owns outright. A function the
 * user defined in their own project keeps whatever runtime they chose, even
 * though it is the same shape.
 */
const OWNED_INFRA_DIRS = [
  `${PACKAGES_DIR}/${SHARED_CONSTRUCTS_DIR}/`,
  `${PACKAGES_DIR}/${SHARED_TERRAFORM_DIR}/`,
] as const;

const isOwnedInfraFile = (path: string): boolean =>
  OWNED_INFRA_DIRS.some((dir) => path.startsWith(dir));

/**
 * A Lambda runtime a vended file declares, and where it sits.
 *
 * Anchored on the `runtime` assignment so only a Lambda runtime matches — a
 * `Runtime` reference anywhere else in the file is left alone.
 */
interface DeclaredRuntime {
  /** Exact text to rewrite, e.g. `runtime: lambda.Runtime.NODEJS_22_X`. */
  readonly match: string;
  readonly language: ILambdaRuntime;
  /**
   * Version the runtime names, or undefined for an alias like `NODEJS_LATEST`
   * whose value `aws-cdk-lib` decides rather than this repo.
   */
  readonly version?: string;
}

/** `NODEJS_22_X` -> `22`, `PYTHON_3_14` -> `3.14`; undefined for an alias. */
const cdkMemberVersion = (member: string): string | undefined =>
  /^NODEJS_(\d+)_X$/.exec(member)?.[1] ??
  /^PYTHON_(\d+)_(\d+)$/.exec(member)?.slice(1).join('.');

/** Every runtime a vended CDK construct assigns. */
const declaredCdkRuntimes = (contents: string): DeclaredRuntime[] =>
  [
    ...contents.matchAll(
      /\bruntime:\s*((?:lambda\.)?Runtime\.((?:NODEJS|PYTHON)_[A-Z0-9_]+))/g,
    ),
  ].map(([, reference, member]) => ({
    match: `runtime: ${reference}`,
    language: member.startsWith('NODEJS')
      ? ('node' as const)
      : ('python' as const),
    version: cdkMemberVersion(member),
  }));

/** Every runtime a vended Terraform module assigns. */
const declaredTerraformRuntimes = (contents: string): DeclaredRuntime[] =>
  [
    ...contents.matchAll(/\bruntime\s*=\s*"((?:nodejs|python)[0-9][^"]*)"/g),
  ].map(([, identifier]) => ({
    match: `runtime = "${identifier}"`,
    language: identifier.startsWith('nodejs')
      ? ('node' as const)
      : ('python' as const),
    version:
      /^nodejs([\d.]+?)\.x$/.exec(identifier)?.[1] ??
      /^python([\d.]+)$/.exec(identifier)?.[1],
  }));

/**
 * Sync the Lambda runtimes vended into `common/constructs` and
 * `common/terraform`.
 *
 * The runtimes present are read from the file rather than compared against a list
 * of what past releases vended, which would need maintaining by hand for the same
 * reason the pin itself does.
 *
 * A runtime below the pin is ours to move, as is a `_LATEST` alias — its value is
 * decided by `aws-cdk-lib`, which is the drift this replaces. A runtime at or
 * ahead of the pin is the user's and is left. One in a shape the rewrite cannot
 * reach is reported instead.
 *
 * @returns the files changed, and the owned files still holding an older runtime
 */
const syncLambdaRuntimes = async (
  tree: Tree,
): Promise<{ updated: string[]; diverged: string[] }> => {
  const files: { path: string; hcl: boolean }[] = [];

  visitNotIgnoredFiles(tree, '.', (path) => {
    if (!isOwnedInfraFile(path)) {
      return;
    }
    if (path.endsWith('.ts')) {
      files.push({ path, hcl: false });
    } else if (path.endsWith('.tf')) {
      files.push({ path, hcl: true });
    }
  });

  const updated: string[] = [];
  const diverged: string[] = [];

  for (const { path, hcl } of files) {
    const contents = tree.read(path, 'utf-8') ?? '';
    const declared = hcl
      ? declaredTerraformRuntimes(contents)
      : declaredCdkRuntimes(contents);

    let changed = false;
    let stale = false;

    // Deduped: one rewrite covers every occurrence of the same assignment.
    const seen = new Set<string>();
    for (const runtime of declared) {
      if (seen.has(runtime.match)) {
        continue;
      }
      seen.add(runtime.match);

      const vended = hcl
        ? terraformLambdaRuntime(runtime.language)
        : cdkLambdaRuntime(runtime.language);
      const replacement = hcl
        ? `runtime = "${vended}"`
        : runtime.match.replace(
            /Runtime\.(?:NODEJS|PYTHON)_[A-Z0-9_]+$/,
            vended,
          );

      if (runtime.match === replacement) {
        continue;
      }
      // An alias carries no version to compare, and is always ours to pin.
      if (
        runtime.version !== undefined &&
        !isVendedUpgrade(
          LAMBDA_RUNTIME_VERSIONS[runtime.language],
          runtime.version,
        )
      ) {
        continue;
      }

      const prefix = hcl ? 'language hcl\n' : '';
      if (
        await applyGritQL(
          tree,
          path,
          `${prefix}\`${runtime.match}\` => \`${replacement}\``,
        )
      ) {
        changed = true;
      } else {
        stale = true;
      }
    }

    if (changed) {
      updated.push(path);
    }
    if (stale) {
      diverged.push(path);
    }
  }

  return { updated, diverged };
};

/**
 * Sync the interpreter a uv project pins to the Lambda Python runtime.
 *
 * `.python-version` holds the exact interpreter and `[project].requires-python`
 * its lower bound; Ruff's `target-version` is derived from the latter, so leaving
 * these behind lints against a different version than the function runs on. Only
 * moved forward, and only from a value this plugin vended.
 */
const syncProjectPythonVersion = (tree: Tree): string[] => {
  const updated: string[] = [];
  const vendedInterpreter = pyenvPythonVersion();
  const vendedRequires = pyprojectPythonDependency();

  // Every `.python-version`, not just the root: uv writes one per project too,
  // and a project left behind resolves a different interpreter than it deploys on.
  visitNotIgnoredFiles(tree, '.', (path) => {
    if (path !== '.python-version' && !path.endsWith('/.python-version')) {
      return;
    }
    const declared = (tree.read(path, 'utf-8') ?? '').trim();
    if (declared && isVendedUpgrade(vendedInterpreter, declared)) {
      tree.write(path, `${vendedInterpreter}\n`);
      updated.push(path);
    }
  });

  visitNotIgnoredFiles(tree, '.', (path) => {
    if (!path.endsWith('pyproject.toml')) {
      return;
    }
    let changed = false;
    updateToml(tree, path, (toml) => {
      const project = toml.project as Record<string, unknown> | undefined;
      const declared = project?.['requires-python'];
      if (typeof declared !== 'string') {
        return toml;
      }
      // Only the `>=<major>.<minor>` shape the generators write, so a specifier
      // the user tightened or widened is theirs to keep.
      const lower = /^>=\s*(\d+\.\d+)$/.exec(declared.trim());
      if (lower && isVendedUpgrade(LAMBDA_RUNTIME_VERSIONS.python, lower[1])) {
        project!['requires-python'] = vendedRequires;
        changed = true;
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
 * Sync the Python version a `bundle` target resolves wheels against.
 *
 * The target pins `--python-platform` but earlier releases pinned no
 * `--python-version`, so wheels resolved against whichever interpreter the build
 * machine had rather than the Lambda runtime. Both the missing flag and a stale
 * one are corrected, keyed on the `uv pip install` the generators write.
 */
const syncPythonBundleVersion = (tree: Tree): string[] => {
  const updated: string[] = [];
  const vended = LAMBDA_RUNTIME_VERSIONS.python;

  visitNotIgnoredFiles(tree, '.', (path) => {
    if (!path.endsWith('project.json')) {
      return;
    }
    let changed = false;
    updateJson(tree, path, (json) => {
      for (const target of Object.values(
        (json.targets ?? {}) as Record<string, { options?: unknown }>,
      )) {
        const options = target.options as { commands?: unknown[] } | undefined;
        if (!Array.isArray(options?.commands)) {
          continue;
        }
        options.commands = options.commands.map((command) => {
          if (
            typeof command !== 'string' ||
            !command.includes('uv pip install') ||
            !command.includes('--python-platform')
          ) {
            return command;
          }
          const declared = /--python-version (\S+)/.exec(command);
          if (!declared) {
            changed = true;
            return command.replace(
              /(--python-platform \S+)/,
              `$1 --python-version ${vended}`,
            );
          }
          if (isVendedUpgrade(vended, declared[1])) {
            changed = true;
            return command.replace(
              /--python-version \S+/,
              `--python-version ${vended}`,
            );
          }
          return command;
        });
      }
      return json;
    });
    if (changed) {
      updated.push(path);
    }
  });

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
  const overrides = syncOverrides(tree, owned);
  const pyProjects = syncPyProjects(tree, owned);
  const terraformFiles = await syncTerraformProviders(tree);
  const lambdaRuntimes = await syncLambdaRuntimes(tree);
  const projectPython = syncProjectPythonVersion(tree);
  const pythonBundles = syncPythonBundleVersion(tree);
  const skippedEmbedded = await syncEmbeddedVersions(tree, owned);
  await syncMetricsVersion(tree);

  // Lock files are left to the user: `nx migrate` only installs when the root
  // manifest changes, and never runs `uv` or `terraform`.
  if (catalogs.length > 0 || packageJsons.length > 0 || overrides.length > 0) {
    nextSteps.push(
      `TypeScript dependency versions were updated. Run \`${buildInstallCommand(
        detectPackageManager(tree.root),
      )}\` to update the lock file.`,
    );
  }
  if (
    pyProjects.length > 0 ||
    projectPython.length > 0 ||
    pythonBundles.length > 0
  ) {
    nextSteps.push(
      `Python dependency versions were updated in ${[...new Set([...pyProjects, ...projectPython, ...pythonBundles])].join(', ')}. Run \`uv sync\` to update uv.lock.`,
    );
  }
  // A runtime the sync recognised is simply moved; one it doesn't recognise is
  // the user's choice, so it is reported rather than rewritten.
  if (lambdaRuntimes.diverged.length > 0) {
    nextSteps.push(
      `Lambda runtimes in ${[...new Set(lambdaRuntimes.diverged)].join(', ')} have diverged from the generated shape and were left untouched. Set them to \`${cdkLambdaRuntime('node')}\` (CDK) or \`"${terraformLambdaRuntime('node')}"\` (Terraform) if you want them on the runtime this release vends.`,
    );
  }
  if (terraformFiles.length > 0) {
    nextSteps.push(
      `Terraform provider versions were updated in ${terraformFiles.length} file(s). Run \`terraform init -upgrade\` in each Terraform project to update its lock file.`,
    );
  }
  // A synced embedded pin needs no next step — it is read the next time the thing
  // holding it runs. A file the sync left alone does: its versions are still the
  // old ones, and only the user can reconcile that.
  if (skippedEmbedded.length > 0) {
    nextSteps.push(
      `Version pins were left as they are in ${skippedEmbedded.join(', ')}, which repeat a pin more times than this migration rewrites at once. Update them by hand.`,
    );
  }

  // Without this the workspace's own format check fails on the migrated files.
  await formatFilesInSubtree(tree);

  return { nextSteps };
};
