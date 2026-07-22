/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  detectPackageManager,
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  readNxJson,
  type Tree,
  updateJson,
  updateNxJson,
} from '@nx/devkit';
import { initGenerator } from '@nx/js';
import { readFileSync } from 'fs';
import yaml from 'js-yaml';
import { readModulePackageJson } from 'nx/src/utils/package-json';
import GeneratorsJson from '../../generators.json' with { type: 'json' };
import { SYNC_GENERATOR_NAME as TS_SYNC_GENERATOR_NAME } from '../ts/sync/generator';
import { BASE_TSCONFIG_COMPILER_OPTIONS } from './base-tsconfig';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from './config/utils';
import { type Containers, inferContainers } from './containers';
import { DEFAULT_BIOME_CONFIG } from './format';
import type { Iac } from './iac';
import { configureMcpServers } from './mcp';
import { getNpmScope } from './npm-scope';
import { mergeTargetDefault } from './nx';
import { getPackageManagerDisplayCommands } from './pkg-manager';
import { withVersions } from './versions';

const WORKSPACES = ['packages/*'];
const NX_TYPESCRIPT_SYNC_GENERATOR = '@nx/js:typescript-sync';

// Built dependencies whose install scripts the generated workspace trusts.
// `onlyBuiltDependencies` is the pnpm 10 key (silently ignored by pnpm 11);
// pnpm 11 reads `allowBuilds` instead. Any dep NOT in this allowlist will
// have its install scripts skipped with a warning — matching pnpm 10's
// default behaviour. The user can opt-in later via `pnpm approve-builds`.
export const PNPM_BUILT_DEPENDENCIES = ['@swc/core', 'esbuild', 'nx', 'sharp'];

/**
 * Options controlling how the workspace is initialised. These mirror the
 * preset schema so a workspace created via the preset and one initialised via
 * the `init` generator end up in the same shape.
 */
export interface ApplyWorkspaceInitOptions {
  /** The IaC provider to record in the plugin config. */
  readonly iac: Iac;
  /**
   * The container engine to record. `undefined`/`'infer'` picks docker when
   * installed, else finch.
   */
  readonly containers?: Containers | 'infer';
  /** Whether to configure MCP servers for coding agents. Defaults to true. */
  readonly mcp?: boolean;
  /**
   * How to treat the generated workspace README. The preset owns the README of
   * a greenfield workspace (`Overwrite`); the `init` generator must not clobber
   * an existing workspace's README (`KeepExisting`, the default).
   */
  readonly readmeOverwriteStrategy?: OverwriteStrategy;
  /**
   * Whether to overwrite root package.json scripts that already exist. The
   * preset owns a greenfield workspace's scripts (`true`); the `init`
   * generator must not clobber an existing workspace's scripts (`false`,
   * the default) — it only adds the convenience scripts that are absent.
   */
  readonly overwriteScripts?: boolean;
}

/**
 * Add or repair the pnpm `allowBuilds` / `onlyBuiltDependencies` allowlist for
 * the workspace's `packages` globs, without clobbering any packages the user
 * has already declared.
 *
 * A workspace not created by the preset commonly has either no
 * `pnpm-workspace.yaml`, one missing the `packages` globs, or one carrying the
 * broken `set this to true or false` placeholder pnpm writes when it skips a
 * build script. This makes the file self-consistent so the first generator's
 * install doesn't fail with `ERR_PNPM_IGNORED_BUILDS`.
 */
const setUpPnpmWorkspace = (tree: Tree) => {
  const existing = tree.exists('pnpm-workspace.yaml')
    ? ((yaml.load(tree.read('pnpm-workspace.yaml', 'utf-8') ?? '') as Record<
        string,
        unknown
      >) ?? {})
    : {};

  // Preserve any packages globs the user already has, ensuring ours are present.
  const packages = Array.from(
    new Set([...((existing.packages as string[]) ?? []), ...WORKSPACES]),
  );

  const allowBuilds = {
    ...(typeof existing.allowBuilds === 'object' && existing.allowBuilds
      ? (existing.allowBuilds as Record<string, unknown>)
      : {}),
    // Overwrite any non-boolean (e.g. the "set this to true or false"
    // placeholder) with an explicit true for the deps we trust.
    ...Object.fromEntries(PNPM_BUILT_DEPENDENCIES.map((dep) => [dep, true])),
  };

  tree.write(
    'pnpm-workspace.yaml',
    yaml.dump(
      {
        ...existing,
        packages,
        allowBuilds,
        onlyBuiltDependencies: PNPM_BUILT_DEPENDENCIES,
      },
      { quotingType: "'" },
    ),
  );
};

/**
 * Configure the workspace's package manager for a monorepo layout.
 *
 * pnpm workspaces are declared in `pnpm-workspace.yaml`; every other package
 * manager reads the `workspaces` field of the root `package.json`.
 */
const setUpWorkspaces = (tree: Tree) => {
  if (detectPackageManager() === 'pnpm') {
    setUpPnpmWorkspace(tree);
  } else {
    updateJson(tree, 'package.json', (json) => ({
      ...json,
      workspaces: Array.from(
        new Set([...(json.workspaces ?? []), ...WORKSPACES]),
      ),
    }));
  }
};

/**
 * Ensure the workspace has a `tsconfig.base.json`.
 *
 * `@nx/js` `initGenerator` (with `addTsPlugin`) normally creates this, but it
 * short-circuits when the workspace already has a root `tsconfig.json` — in
 * which case no base file is written and the next project generator fails with
 * `Cannot find tsconfig.base.json`. So we create a compatible one when it's
 * absent. An existing base is left untouched: the user may have tuned it, and
 * rewriting shared compiler options can break other projects (see the
 * "add to an existing workspace" guide).
 */
const ensureBaseTsConfig = (tree: Tree) => {
  if (tree.exists('tsconfig.base.json')) {
    return;
  }
  tree.write(
    'tsconfig.base.json',
    JSON.stringify(
      {
        compilerOptions: {
          ...BASE_TSCONFIG_COMPILER_OPTIONS,
          customConditions: [getNpmScope(tree)],
        },
      },
      null,
      2,
    ),
  );
};

/**
 * Ensure the workspace has a root `tsconfig.json`.
 *
 * Nx's `@nx/js:typescript-sync` generator hard-fails with
 * `Missing root "tsconfig.json"` when it's absent. The plugin's TypeScript
 * projects reference each other via this file, so we guarantee a minimal one
 * exists (sync populates its `references`).
 */
const ensureRootTsConfig = (tree: Tree) => {
  if (tree.exists('tsconfig.json')) {
    return;
  }
  tree.write(
    'tsconfig.json',
    JSON.stringify(
      {
        extends: './tsconfig.base.json',
        files: [],
        references: [],
      },
      null,
      2,
    ),
  );
};

/**
 * Transform an Nx workspace into one ready to run `@aws/nx-plugin` generators.
 *
 * This is the deterministic core shared by the workspace preset and the `init`
 * generator. It is safe to re-run: every step is idempotent (config merges,
 * keyed nx.json / package.json entries, create-if-missing files), so running
 * it against an already-initialised workspace is a no-op.
 *
 * It preserves the workspace's module format: the root package.json `type`
 * field is owned by the preset (written from its `--module` option) and left
 * untouched here. It does NOT rewrite an existing `tsconfig.base.json`'s
 * compiler options, migrate a workspace's package manager, or restructure
 * existing projects — those are decisions for the user (see the "add to an
 * existing workspace" guide).
 */
export const applyWorkspaceInit = async (
  tree: Tree,
  {
    iac,
    containers,
    mcp,
    readmeOverwriteStrategy = OverwriteStrategy.KeepExisting,
    overwriteScripts = false,
  }: ApplyWorkspaceInitOptions,
) => {
  const resolvedContainers =
    !containers || containers === 'infer' ? inferContainers() : containers;

  // Write IaC provider and container engine to plugin config
  await ensureAwsNxPluginConfig(tree);
  await updateAwsNxPluginConfig(tree, {
    iac: { provider: iac },
    containers: { engine: resolvedContainers },
  });

  // Set up the TypeScript plugin, base tsconfig, formatter etc. `@nx/js`
  // creates `tsconfig.base.json` when absent, but skips it when a root
  // `tsconfig.json` already exists — so we ensure both explicitly below.
  await initGenerator(tree, {
    formatter: 'none',
    addTsPlugin: true,
  });

  ensureBaseTsConfig(tree);
  ensureRootTsConfig(tree);

  setUpWorkspaces(tree);

  const nxJson = readNxJson(tree);
  updateNxJson(tree, {
    ...nxJson,
    // Preserve an explicit analytics choice in an existing workspace.
    analytics: (nxJson as { analytics?: boolean }).analytics ?? false,
    targetDefaults: {
      ...nxJson.targetDefaults,
      compile: mergeTargetDefault(nxJson.targetDefaults?.compile, (base) => ({
        ...base,
        syncGenerators: [
          ...(base.syncGenerators ?? []).filter(
            (g) =>
              ![TS_SYNC_GENERATOR_NAME, NX_TYPESCRIPT_SYNC_GENERATOR].includes(
                g,
              ),
          ),
          NX_TYPESCRIPT_SYNC_GENERATOR,
          TS_SYNC_GENERATOR_NAME,
        ],
      })),
    },
  });

  const CONVENIENCE_SCRIPTS = {
    dev: 'nx run-many --target dev',
    build: 'nx run-many --target build',
    lint: 'nx run-many --target lint --configuration=fix',
    test: 'nx run-many --target test --all',
    // Trivy container image scanning is not part of `build` (its result
    // depends on the ever-changing vulnerability database); run it explicitly,
    // e.g. in CI.
    trivy: 'nx run-many --target trivy --all',
    'build:skip-lint': 'nx run-many --target build --configuration=skip-lint',
    'build:all': 'nx run-many --target build --all',
    'affected:all': 'nx affected --target build',
  };
  updateJson(tree, 'package.json', (packageJson) => ({
    ...packageJson,
    // The root `type` field is owned by the preset (written explicitly from
    // its `--module` option). `init` preserves an existing workspace's field
    // as-is: an ESM workspace already carries `type: "module"` (that is how
    // the format is inferred), and introducing a `type` into a CommonJS
    // workspace that lacks one changes behaviour for frameworks that parse it
    // (e.g. Next.js starts treating the app's ESM source as CJS).
    scripts: overwriteScripts
      ? { ...packageJson.scripts, ...CONVENIENCE_SCRIPTS }
      : { ...CONVENIENCE_SCRIPTS, ...packageJson.scripts },
  }));

  // Pin the workspace's `nx` to the version the plugin's @nx/* packages are
  // built against. A mismatched workspace nx (even a patch apart) hoists a
  // second nested nx under @nx/js, and the two instances deadlock `nx sync`.
  // `@nx/js` must be a root dependency for the `@nx/js:typescript-sync`
  // generator registered in nx.json to resolve (npm doesn't hoist the
  // plugin's own copy reliably).
  const nxVersion = readModulePackageJson('@nx/js').packageJson.version;
  addDependenciesToPackageJson(
    tree,
    {},
    {
      nx: nxVersion,
      '@nx/js': nxVersion,
      '@nx/workspace': nxVersion,
      ...withVersions(['typescript', '@biomejs/biome']),
    },
  );

  // Write biome.json for formatting and linting
  if (!tree.exists('biome.json')) {
    tree.write('biome.json', JSON.stringify(DEFAULT_BIOME_CONFIG, null, 2));
  }

  generateFiles(
    tree, // the virtual file system
    joinPathFragments(import.meta.dirname, '..', 'preset', 'files'),
    '.',
    {
      projectName: getNpmScope(tree),
      generators: Object.entries(GeneratorsJson.generators)
        .filter(([_, v]) => !v['hidden'])
        .map(([k, v]) => ({ name: k, description: v.description })),
      ...(() => {
        const cmds = getPackageManagerDisplayCommands();
        return {
          pkgMgrCmd: cmds.exec,
          buildCmd: `${cmds.run} build`,
          lintCmd: `${cmds.run} lint`,
        };
      })(),
    },
    {
      overwriteStrategy: readmeOverwriteStrategy,
    },
  );

  if (mcp !== false) {
    configureMcpServers(tree);
  }
};
