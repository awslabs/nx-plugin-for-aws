/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Biome } from '@biomejs/js-api/nodejs';
import { getProjects, type Tree } from '@nx/devkit';
import {
  type ExecSyncOptionsWithStringEncoding,
  execSync,
} from 'child_process';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { uvxCommand } from './py';
import { readToml } from './toml';
import { TS_VERSIONS } from './versions';

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

/**
 * Format files in the given directory within the tree.
 * Handles both TypeScript/JavaScript/JSON (via biome) and Python (via ruff) files.
 * See https://github.com/nrwl/nx/blob/4cd640a9187954505d12de5b6d76a90d8ce4c2eb/packages/devkit/src/generators/format-files.ts#L11
 */
export async function formatFilesInSubtree(
  tree: Tree,
  dir?: string,
): Promise<void> {
  const changedFiles = tree
    .listChanges()
    .filter((file) => file.type !== 'DELETE')
    .filter((file) => (dir ? file.path.startsWith(dir) : true));

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

  // Run ruff from the workspace root so it resolves the same on-disk config
  // hasRuffConfigOnDisk probed for. An in-memory tree has no root on disk, in
  // which case there is no config to find and the process cwd is left alone.
  const ruffCwd =
    pyFiles.length && existsSync(tree.root) ? tree.root : undefined;

  // Format Python files with ruff (lint fixes + formatting)
  for (const file of pyFiles) {
    try {
      const content = ruffFixAndFormat(
        file.content.toString('utf-8'),
        file.path,
        hasRuffConfigOnDisk(tree, file.path),
        ruffCwd,
        getOwningProjectRuffConfig(file.path, pythonProjectConfigs),
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
 * Format files with Biome in-process, reusing one instance across the batch.
 *
 * The workspace's own `biome.json` still applies: `tree.read` falls through to
 * disk, so a customised config — including path-based `overrides` — formats
 * exactly as the workspace's `format` target would, and unlike shelling out to
 * the CLI this also sees config a generator has just written to the tree.
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
    // The workspace's own config when it has one, else the config we vend.
    const workspaceConfig = tree.read('biome.json', 'utf-8');
    biome.applyConfiguration(
      projectKey,
      workspaceConfig
        ? JSON.parse(workspaceConfig)
        : getDefaultBiomeConfig(tree),
    );

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
 * Find the ruff command: `uvx --from ruff==<version> ruff`. uvx works
 * regardless of workspace resolution state (unlike `uv run ruff`, which fails
 * while installs are deferred), and the version pin matches the project's
 * `format` target (PY_VERSIONS) so generation and check format identically.
 * Only a successful probe is cached — ruff can become available mid-run in the
 * long-lived Nx daemon, so a cached failure would skip formatting thereafter.
 */
let _ruffCommand: string | undefined;
function getRuffCommand(): string | undefined {
  if (_ruffCommand) {
    return _ruffCommand;
  }
  const cmd = uvxCommand('ruff');
  try {
    execSync(`${cmd} --version`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    _ruffCommand = cmd;
    return cmd;
  } catch {
    return undefined;
  }
}

/**
 * Whether ruff would discover a config on disk for a file, by walking from its
 * directory up to the workspace root looking for `.ruff.toml`, `ruff.toml`, or a
 * `pyproject.toml` with a `[tool.ruff]` section — the same files ruff itself
 * resolves. The walk stops at `tree.root` so a stray config in a parent of the
 * workspace (or the home directory) is never treated as the project's. Used to
 * decide whether to nudge ruff towards import sorting (see
 * {@link ruffFixAndFormat}).
 */
function hasRuffConfigOnDisk(tree: Tree, filePath: string): boolean {
  const root = path.resolve(tree.root);
  let dir = path.resolve(root, path.dirname(filePath));
  while (true) {
    if (
      existsSync(path.join(dir, '.ruff.toml')) ||
      existsSync(path.join(dir, 'ruff.toml'))
    ) {
      return true;
    }
    const pyproject = path.join(dir, 'pyproject.toml');
    if (
      existsSync(pyproject) &&
      readFileSync(pyproject, 'utf-8').includes('[tool.ruff')
    ) {
      return true;
    }
    const parent = path.dirname(dir);
    // Stop once the workspace root has been checked (or we hit the FS root).
    if (dir === root || parent === dir) {
      return false;
    }
    dir = parent;
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
    const pyprojectPath = path.join(project.root, 'pyproject.toml');
    if (tree.exists(pyprojectPath)) {
      try {
        const pyproject = readToml(tree, pyprojectPath) as any;
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
      } catch {
        // Skip projects whose pyproject.toml cannot be parsed
      }
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
 * Run ruff check --fix and ruff format on Python file content via stdin.
 * Applies all configured lint fixes (including import sorting) and formatting.
 *
 * When no ruff config exists on disk (`hasConfig` false) ruff would fall back to
 * its own defaults, which change between releases — 0.16 widened them from `E`
 * and `F` to 36 rule prefixes — so generation would apply fixes the project's
 * build never asks for (eg `RUF022` reordering `__all__`). Instead run
 * `--isolated` with the project's own `lint.select` pinned, so generation
 * enforces exactly what `lint` does and nothing more. `--isolated` also stops
 * ruff walking above the workspace to a stray config on the host.
 *
 * When a config does exist we defer to it entirely, honouring the user's rule
 * selection, and run from `tree.root` so ruff discovers it.
 *
 * `projectConfig` carries the owning project's ruff settings, which ruff cannot
 * detect from the filesystem during generation because the project lives only
 * in the tree. We pass them via `--config` so in-tree formatting matches the
 * on-disk build: `known-first-party` (the project's own modules) keeps its
 * imports in their own group, and `line-length` keeps wrapping consistent (the
 * generated config raises it above ruff's default of 88). These are additive to
 * any on-disk config, so they are safe to pass regardless of `hasConfig`.
 */
function ruffFixAndFormat(
  content: string,
  filePath: string,
  hasConfig: boolean,
  cwd: string | undefined,
  projectConfig?: PythonProjectRuffConfig,
): string {
  const ruff = getRuffCommand();
  if (!ruff) return content;

  const configArgs: string[] = [];
  // Pin the rule selection only when deferring to ruff's defaults would
  // otherwise apply rules the project's build does not enforce.
  const isolated = !hasConfig;
  if (isolated) {
    configArgs.push(
      `lint.select = ${JSON.stringify(projectConfig?.select ?? DEFAULT_RUFF_SELECT)}`,
    );
  }
  if (projectConfig?.modules.length) {
    configArgs.push(
      `lint.isort.known-first-party = ${JSON.stringify(projectConfig.modules)}`,
    );
  }
  if (typeof projectConfig?.lineLength === 'number') {
    configArgs.push(`line-length = ${projectConfig.lineLength}`);
  }
  if (projectConfig?.targetVersion) {
    configArgs.push(`target-version = "${projectConfig.targetVersion}"`);
  }
  const config = configArgs
    .map((arg) => ` --config ${JSON.stringify(arg)}`)
    .join('');
  const flags = `${isolated ? ' --isolated' : ''}${config}`;
  // Built per invocation: `input` carries the content the previous step emitted.
  const options = (input: string): ExecSyncOptionsWithStringEncoding => ({
    input,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(cwd ? { cwd } : {}),
  });

  // First apply lint fixes (import sorting, unused imports, etc.)
  try {
    const result = execSync(
      `${ruff} check --fix${flags} --stdin-filename ${filePath} -`,
      options(content),
    );
    content = result;
  } catch (e: any) {
    // ruff check exits non-zero when it finds unfixable issues,
    // but stdout still contains the fixed content
    if (e.stdout) {
      content = e.stdout;
    }
  }

  // Then apply formatting
  try {
    content = execSync(
      `${ruff} format${flags} --stdin-filename ${filePath} -`,
      options(content),
    );
  } catch {
    // Fall through with whatever content we have
  }

  return content;
}
