/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Biome } from '@biomejs/js-api/nodejs';
import { getProjects, type Tree } from '@nx/devkit';
import { execFileSync, execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { uvxCommand } from './py';
import { readToml } from './toml';
import { TS_VERSIONS } from './versions';

const require = createRequire(import.meta.url);

export const DEFAULT_BIOME_CONFIG = {
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
    // Resolve dependencies declared via the package manager's catalog so
    // `noUndeclaredDependencies` understands `catalog:` references.
    resolver: {
      experimentalPnpmCatalogs: true,
    },
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
  // Config files, build scripts and tests import shared build/test tooling
  // from the workspace root rather than declaring it per-project, so the
  // undeclared-dependency rule is disabled for them (source code stays
  // enforced).
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
};

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

  // Format Python files with ruff (lint fixes + formatting)
  for (const file of pyFiles) {
    try {
      const content = ruffFixAndFormat(
        file.content.toString('utf-8'),
        file.path,
        hasRuffConfigOnDisk(tree, file.path),
        getOwningProjectRuffConfig(file.path, pythonProjectConfigs),
      );
      tree.write(file.path, content);
    } catch {
      // Silently skip ruff formatting failures
    }
  }

  if (otherFiles.length === 0) return;

  // Use the workspace's own Biome CLI (its version and config) when biome.json
  // exists on disk; otherwise format via the bundled library API with the
  // in-memory tree config. The CLI path does not see in-tree config changes.
  if (existsSync(path.join(tree.root, 'biome.json'))) {
    formatWithBiomeCli(tree, otherFiles);
  } else {
    formatWithBiomeApi(tree, otherFiles);
  }
}

/**
 * Format files via the workspace's Biome CLI, run from the workspace root so it
 * discovers the on-disk biome.json.
 */
function formatWithBiomeCli(
  tree: Tree,
  files: { path: string; content: Buffer | null }[],
): void {
  const biome = getBiomeCommand(tree.root);
  if (!biome) {
    // Fall back to the library API if the CLI cannot be resolved
    formatWithBiomeApi(tree, files);
    return;
  }

  for (const file of files) {
    try {
      const content = execFileSync(
        biome.command,
        [...biome.args, 'format', `--stdin-file-path=${file.path}`],
        {
          input: file.content?.toString('utf-8') ?? '',
          encoding: 'utf-8',
          cwd: tree.root,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      tree.write(file.path, content);
    } catch {
      // Leave individual files that fail to format untouched
    }
  }
}

/**
 * Format files via the bundled Biome library API, applying the in-memory tree
 * config.
 */
function formatWithBiomeApi(
  tree: Tree,
  files: { path: string; content: Buffer | null }[],
): void {
  try {
    const biome = new Biome();
    const { projectKey } = biome.openProject();
    // Apply the workspace biome.json if it exists in the tree, otherwise the defaults.
    const treeConfig = tree.read('biome.json', 'utf-8');
    biome.applyConfiguration(
      projectKey,
      treeConfig ? JSON.parse(treeConfig) : DEFAULT_BIOME_CONFIG,
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

interface BiomeCommand {
  command: string;
  args: string[];
}

/**
 * Resolve the `@biomejs/biome` CLI from the user's workspace, falling back to a
 * `biome` binary on the PATH.
 */
const _biomeCommands = new Map<string, BiomeCommand | null>();
function getBiomeCommand(root: string): BiomeCommand | undefined {
  if (_biomeCommands.has(root)) {
    return _biomeCommands.get(root) ?? undefined;
  }

  // Run via node for cross-platform execution of the bin shim.
  try {
    const pkgJsonPath = require.resolve('@biomejs/biome/package.json', {
      paths: [root, import.meta.dirname],
    });
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    const binRelative =
      typeof pkgJson.bin === 'string' ? pkgJson.bin : pkgJson.bin?.biome;
    if (binRelative) {
      const binPath = path.join(path.dirname(pkgJsonPath), binRelative);
      const command = { command: process.execPath, args: [binPath] };
      _biomeCommands.set(root, command);
      return command;
    }
  } catch {
    // Fall back to a biome binary on the PATH
  }

  try {
    execSync('biome --version', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const command = { command: 'biome', args: [] };
    _biomeCommands.set(root, command);
    return command;
  } catch {
    _biomeCommands.set(root, null);
    return undefined;
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
 * `[tool.hatch.build.targets.wheel].packages`) and its `[tool.ruff].line-length`.
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
        if (modules.length || typeof lineLength === 'number' || targetVersion) {
          configs.push({
            root: project.root.split(path.sep).join('/'),
            modules,
            lineLength: typeof lineLength === 'number' ? lineLength : undefined,
            targetVersion,
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
 * When no ruff config exists on disk (`hasConfig` false) ruff falls back to its
 * defaults, which omit isort — but generated projects enable rule `I` and their
 * build fails on unsorted imports (I001). In that case we add `--extend-select
 * I` so import sorting matches what the build enforces. When a config does
 * exist we defer to it entirely, honouring the user's rule selection.
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
  projectConfig?: PythonProjectRuffConfig,
): string {
  const ruff = getRuffCommand();
  if (!ruff) return content;

  const extendSelect = hasConfig ? '' : ' --extend-select I';
  const configArgs: string[] = [];
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

  // First apply lint fixes (import sorting, unused imports, etc.)
  try {
    const result = execSync(
      `${ruff} check --fix${extendSelect}${config} --stdin-filename ${filePath} -`,
      { input: content, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
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
      `${ruff} format${config} --stdin-filename ${filePath} -`,
      {
        input: content,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
  } catch {
    // Fall through with whatever content we have
  }

  return content;
}
