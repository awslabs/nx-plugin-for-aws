/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Biome } from '@biomejs/js-api/nodejs';
import { getProjects, type Tree } from '@nx/devkit';
import { createRequire } from 'module';
import path from 'path';
import { type RuffOptions, ruffFixAndFormat } from './ruff.js';
import { tryReadToml } from './toml.js';
import { TS_VERSIONS } from './versions.js';

/**
 * The Biome release the wasm bindings here are built from. Those bindings format
 * generated TypeScript/JSON in-process, while `TS_VERSIONS['@biomejs/biome']` is
 * the CLI the vended `format`/`lint` targets run and the version the vended
 * `biome.json` `$schema` points at — so keep the two in step, or generated files
 * are formatted by one release and checked against another. A test asserts they
 * agree.
 *
 * The package exposes no version API (unlike ruff's `Workspace.version()`), so
 * this reads its manifest.
 */
export const BIOME_WASM_VERSION: string = createRequire(import.meta.url)(
  '@biomejs/wasm-nodejs/package.json',
).version;

/**
 * Excludes test reports — including the vendored scripts vitest's coverage HTML
 * reporter writes — from formatting and linting.
 */
export const BIOME_TEST_OUTPUT_EXCLUDE = '!**/test-output';

/**
 * The biome.json vended into a new workspace. The pnpm catalog resolver is only
 * included on pnpm workspaces, since `experimentalPnpmCatalogs` is Biome's only
 * catalog resolver and reads `pnpm-workspace.yaml` exclusively — it does nothing
 * for yarn or bun catalogs, so vending it there would be misleading.
 */
export const getDefaultBiomeConfig = (tree: Tree) => ({
  $schema: `https://biomejs.dev/schemas/${TS_VERSIONS['@biomejs/biome']}/schema.json`,
  root: true,
  formatter: {
    enabled: true,
    indentStyle: 'space',
    indentWidth: 2,
    lineWidth: 80,
  },
  javascript: {
    formatter: {
      quoteStyle: 'single',
      trailingCommas: 'all',
    },
    // Resolve `catalog:` versions from pnpm-workspace.yaml (pnpm workspaces only).
    ...(tree.exists('pnpm-workspace.yaml')
      ? { resolver: { experimentalPnpmCatalogs: true } }
      : {}),
  },
  css: {
    formatter: {
      quoteStyle: 'single',
    },
    linter: {
      enabled: false,
    },
  },
  linter: {
    enabled: true,
    rules: {
      preset: 'none',
      correctness: {
        // Every project must declare the third-party dependencies its source
        // code imports in its own package.json.
        noUndeclaredDependencies: 'error',
      },
    },
  },
  assist: {
    actions: {
      source: {
        organizeImports: 'on',
      },
    },
  },
  files: {
    includes: [
      '**',
      '!**/dist',
      '!**/out-tsc',
      BIOME_TEST_OUTPUT_EXCLUDE,
      '!**/node_modules',
      '!**/.nx',
      '!**/.venv',
      // GritQL codemod cache written by generators — its sample sources
      // otherwise pollute a bare `biome check .` with parse errors.
      '!**/.grit',
      '!**/*.css',
      '!**/*.gen.*',
      '!**/generated/**',
      '!**/tsconfig*.json',
    ],
  },
  // Config files, build scripts and tests use root tooling rather than
  // declaring it per-project, so the undeclared-dependency rule is off for them.
  overrides: [
    {
      includes: [
        '**/*.config.{ts,mts,cts,js,mjs,cjs}',
        '**/*.{spec,test}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}',
        '**/*.stories.{ts,tsx}',
      ],
      linter: {
        rules: {
          correctness: {
            noUndeclaredDependencies: 'off',
          },
        },
      },
    },
  ],
});

const BIOME_FORMATTABLE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.json',
  '.jsonc',
  '.css',
]);

/** Matches `tsconfig.json` and variants like `tsconfig.lib.json`. */
const isTsConfig = (filePath: string): boolean =>
  /(^|\/)tsconfig[^/]*\.json$/.test(filePath);

export interface FormatFilesInSubtreeOptions {
  /**
   * Paths, relative to the workspace root, to leave untouched.
   *
   * For files another tool owns the formatting of: formatting them here makes
   * generation non-idempotent, since the tool rewrites them in its own shape on
   * the next run and the workspace flips between the two forms.
   */
  readonly ignore?: readonly string[];
}

/**
 * Paths declared ignored for a tree, which stay ignored for every later call.
 *
 * A call formats every change pending in the tree, not only the ones its caller
 * made, so the list cannot be scoped to the call that passes it: generators
 * composing on one tree would reformat a file an earlier generator had excluded.
 * Once the generator that owns a file declares it ignored, it stays ignored for
 * the rest of the run.
 */
const treeIgnoredPaths = new WeakMap<Tree, Set<string>>();

/**
 * Tree paths are workspace-relative and forward-slash separated. Normalise so a
 * caller building a path with `path.join` on Windows still matches.
 */
const normalizeTreePath = (filePath: string): string =>
  filePath.split(path.sep).join('/').replace(/^\.\//, '');

/**
 * Format files in the given directory within the tree.
 * Handles both TypeScript/JavaScript/JSON (via biome) and Python (via ruff) files.
 * See https://github.com/nrwl/nx/blob/4cd640a9187954505d12de5b6d76a90d8ce4c2eb/packages/devkit/src/generators/format-files.ts#L11
 */
export async function formatFilesInSubtree(
  tree: Tree,
  dir?: string,
  options?: FormatFilesInSubtreeOptions,
): Promise<void> {
  let ignored = treeIgnoredPaths.get(tree);
  if (options?.ignore?.length) {
    if (!ignored) {
      ignored = new Set();
      treeIgnoredPaths.set(tree, ignored);
    }
    for (const filePath of options.ignore) {
      ignored.add(normalizeTreePath(filePath));
    }
  }
  const changedFiles = tree
    .listChanges()
    .filter((file) => file.type !== 'DELETE')
    .filter((file) => (dir ? file.path.startsWith(dir) : true))
    .filter((file) => !ignored?.has(normalizeTreePath(file.path)));

  const pyFiles = changedFiles.filter((file) => file.path.endsWith('.py'));
  const otherFiles = changedFiles.filter(
    (file) =>
      BIOME_FORMATTABLE_EXTENSIONS.has(path.extname(file.path)) &&
      // tsconfigs are not biome-managed: they're excluded from the vended
      // format target (Nx's typescript-sync rewrites them without formatting),
      // so formatting them at generation would only diverge from the form
      // written on later runs. Leave them as updateJson/writeJson emit them so
      // repeated generation stays idempotent.
      !isTsConfig(file.path),
  );

  // Resolve each project's ruff settings (module names, line-length) so files
  // are formatted to match the on-disk build (see getPythonProjectRuffConfigs).
  const pythonProjectConfigs = pyFiles.length
    ? getPythonProjectRuffConfigs(tree)
    : [];

  // Format Python files with ruff (lint fixes + formatting)
  for (const file of pyFiles) {
    try {
      const content = ruffFixAndFormat(
        file.content.toString('utf-8'),
        file.path,
        resolveRuffOptions(
          readRuffConfig(tree, file.path),
          getOwningProjectRuffConfig(file.path, pythonProjectConfigs),
        ),
      );
      tree.write(file.path, content);
    } catch {
      // Silently skip ruff formatting failures
    }
  }

  if (otherFiles.length === 0) return;

  formatWithBiome(tree, otherFiles);
}

/**
 * The Biome configuration to format with: the workspace's own `biome.json`, else
 * the config we vend.
 *
 * Read through the tree, which falls back to disk for a file it doesn't hold. So
 * this resolves the most current config either way — the workspace's on-disk one,
 * or the version a generator has just written to the tree and not yet flushed,
 * which shelling out to the CLI could never see.
 */
function readBiomeConfig(tree: Tree): unknown {
  const config = tree.read('biome.json', 'utf-8');
  if (config) {
    try {
      return JSON.parse(config);
    } catch {
      // Malformed config — fall through to the config we vend
    }
  }
  return getDefaultBiomeConfig(tree);
}

/**
 * Format files with Biome in-process, reusing one instance across the batch.
 *
 * Replaces one `biome format --stdin-file-path` process per file, which
 * dominated generation at ~70ms each: `formatFilesInSubtree` formats every
 * change accumulated in the tree, not only the ones its caller made, so
 * generators sharing a tree reformat the same files once per call. In-process is
 * ~0.5ms per file. Output was verified byte-identical across the plugin's whole
 * source tree, except that the CLI corrupts control characters passed through
 * stdin (a NUL in a template literal) where formatting in-process preserves them.
 */
function formatWithBiome(
  tree: Tree,
  files: { path: string; content: Buffer | null }[],
): void {
  try {
    const biome = new Biome();
    const { projectKey } = biome.openProject();
    biome.applyConfiguration(projectKey, readBiomeConfig(tree));

    for (const file of files) {
      try {
        const { content } = biome.formatContent(
          projectKey,
          file.content?.toString('utf-8') ?? '',
          { filePath: file.path },
        );
        tree.write(file.path, content);
      } catch {
        // Leave individual files that fail to format untouched
      }
    }
  } catch {
    // Silently skip formatting failures
  }
}

/**
 * Read the ruff config for a file, by walking from its directory up to the
 * workspace root looking for `.ruff.toml`, `ruff.toml`, or a `pyproject.toml`
 * with a `[tool.ruff]` section — the same files, in the same order, that ruff
 * itself resolves. The walk stops at the workspace root so a stray config in a
 * parent of the workspace (or the home directory) is never treated as the
 * project's.
 *
 * The settings are read rather than merely detected because formatting runs
 * in-process against tree content, so ruff never sees the file's location and
 * cannot resolve the config itself (see {@link resolveRuffOptions}).
 *
 * Reads go through the tree, which falls through to disk for files this run has
 * not touched, so a config the generator has just written in memory is picked up
 * as well as one already on disk.
 */
function readRuffConfig(tree: Tree, filePath: string): RuffOptions | undefined {
  let dir = path.dirname(filePath);
  while (true) {
    for (const name of ['.ruff.toml', 'ruff.toml']) {
      const config = tryReadToml(tree, path.join(dir, name));
      if (config) {
        return config as RuffOptions;
      }
    }
    const ruff = (tryReadToml(tree, path.join(dir, 'pyproject.toml')) as any)
      ?.tool?.ruff;
    if (ruff) {
      return ruff as RuffOptions;
    }
    // Stop once the workspace root ('.') has been checked.
    if (dir === '.' || dir === '' || dir === path.dirname(dir)) {
      return undefined;
    }
    dir = path.dirname(dir);
  }
}

/**
 * The `[tool.ruff.lint].select` generated Python projects vend. Generation
 * formats before that config lands on disk, so it is pinned here to keep
 * generated files clean under the project's own `lint` target rather than under
 * whatever ruff's defaults happen to be for the pinned release.
 */
const DEFAULT_RUFF_SELECT = ['E', 'F', 'UP', 'B', 'SIM', 'I'];

interface PythonProjectRuffConfig {
  /** Project root, normalised to use forward slashes. */
  readonly root: string;
  /** Top-level importable module names declared by the project. */
  readonly modules: string[];
  /** The project's `[tool.ruff].line-length`, if set. */
  readonly lineLength?: number;
  /**
   * Ruff `target-version` (eg `py314`) derived from `[project].requires-python`.
   * Generation formats via stdin with no pyproject, so it must be passed
   * explicitly — ruff's formatting differs by target.
   */
  readonly targetVersion?: string;
  /** The project's `[tool.ruff.lint].select`, if set. */
  readonly select?: string[];
}

/**
 * Derive ruff's `target-version` (eg `py314`) from a PEP 508
 * `requires-python` specifier (eg `>=3.14`). Ruff targets the minimum
 * supported version, so take the lowest `major.minor` mentioned.
 */
export const requiresPythonToRuffTarget = (
  requiresPython: unknown,
): string | undefined => {
  if (typeof requiresPython !== 'string') {
    return undefined;
  }
  let min: { major: number; minor: number } | undefined;
  for (const match of requiresPython.matchAll(/(\d+)\.(\d+)/g)) {
    const major = Number(match[1]);
    const minor = Number(match[2]);
    if (
      !min ||
      major < min.major ||
      (major === min.major && minor < min.minor)
    ) {
      min = { major, minor };
    }
  }
  return min ? `py${min.major}${min.minor}` : undefined;
};

/**
 * Map each Nx project with a `pyproject.toml` to the ruff settings the on-disk
 * build enforces for it: its top-level module names (from
 * `[tool.hatch.build.targets.wheel].packages`), its `[tool.ruff].line-length`
 * and its `[tool.ruff.lint].select`.
 */
function getPythonProjectRuffConfigs(tree: Tree): PythonProjectRuffConfig[] {
  const configs: PythonProjectRuffConfig[] = [];

  for (const project of getProjects(tree).values()) {
    // Projects without a pyproject.toml, or whose one cannot be parsed, have no
    // ruff settings to contribute.
    const pyproject = tryReadToml(
      tree,
      path.join(project.root, 'pyproject.toml'),
    ) as any;
    if (!pyproject) {
      continue;
    }
    const wheelPackages: unknown =
      pyproject?.tool?.hatch?.build?.targets?.wheel?.packages;
    // Record the top-level module segment (`pkg/sub` -> `pkg`), which is
    // all `known-first-party` keys off.
    const modules = Array.isArray(wheelPackages)
      ? wheelPackages
          .filter((pkg): pkg is string => typeof pkg === 'string' && !!pkg)
          .map((pkg) => pkg.split('/')[0])
      : [];
    const lineLength: unknown = pyproject?.tool?.ruff?.['line-length'];
    const targetVersion = requiresPythonToRuffTarget(
      pyproject?.project?.['requires-python'],
    );
    const selected: unknown = pyproject?.tool?.ruff?.lint?.select;
    const select = Array.isArray(selected)
      ? selected.filter(
          (rule): rule is string => typeof rule === 'string' && !!rule,
        )
      : undefined;
    if (
      modules.length ||
      typeof lineLength === 'number' ||
      targetVersion ||
      select?.length
    ) {
      configs.push({
        root: project.root.split(path.sep).join('/'),
        modules,
        lineLength: typeof lineLength === 'number' ? lineLength : undefined,
        targetVersion,
        select: select?.length ? select : undefined,
      });
    }
  }

  return configs;
}

/**
 * Resolve the ruff config for the project that owns a file (the project with
 * the longest root that is a prefix of the file path). Ruff runs per-project on
 * disk, so a file's settings come from its own project — only its own module is
 * first-party (sibling workspace packages are third-party) and its own
 * line-length applies — and scoping this way keeps in-tree formatting
 * consistent with the on-disk build.
 */
function getOwningProjectRuffConfig(
  filePath: string,
  configs: PythonProjectRuffConfig[],
): PythonProjectRuffConfig | undefined {
  let owner: PythonProjectRuffConfig | undefined;
  for (const config of configs) {
    if (
      (filePath === config.root || filePath.startsWith(`${config.root}/`)) &&
      (!owner || config.root.length > owner.root.length)
    ) {
      owner = config;
    }
  }
  return owner;
}

/**
 * Resolve the ruff settings to format a Python file with, mirroring what the
 * file's build enforces.
 *
 * Ruff's own config discovery never runs: settings are passed to the linter
 * directly rather than resolved from the file's location, which it never sees.
 * That also means a stray config above the workspace (or in the home directory)
 * can never be picked up.
 *
 * `config` is the file's nearest ruff config, whose rule selection is honoured
 * as-is. Without one, ruff would fall back to its own defaults, which change
 * between releases — 0.16 widened them from `E` and `F` to 36 rule prefixes — so
 * generation would apply fixes the project's build never asks for (eg `RUF022`
 * reordering `__all__`). Instead the project's own `lint.select` is pinned, so
 * generation enforces exactly what `lint` does and nothing more.
 *
 * `projectConfig` layers on the settings derived from the owning project rather
 * than declared under `[tool.ruff]`: `known-first-party` (the project's own
 * modules, from its wheel packages) keeps its imports in their own group, and
 * `target-version` (from its `requires-python`) matches the formatting the build
 * produces.
 */
function resolveRuffOptions(
  config: RuffOptions | undefined,
  projectConfig?: PythonProjectRuffConfig,
): RuffOptions {
  const lint: Record<string, unknown> = { ...config?.lint };
  // Pin the rule selection only when deferring to ruff's defaults would
  // otherwise apply rules the project's build does not enforce.
  if (!config) {
    lint.select = projectConfig?.select ?? DEFAULT_RUFF_SELECT;
  }
  if (projectConfig?.modules.length) {
    lint.isort = {
      ...(lint.isort as object | undefined),
      'known-first-party': projectConfig.modules,
    };
  }
  return {
    ...config,
    ...(typeof projectConfig?.lineLength === 'number'
      ? { 'line-length': projectConfig.lineLength }
      : {}),
    ...(projectConfig?.targetVersion
      ? { 'target-version': projectConfig.targetVersion }
      : {}),
    lint,
  };
}
