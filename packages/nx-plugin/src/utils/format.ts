/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Biome } from '@biomejs/js-api/nodejs';
import { getProjects, type Tree } from '@nx/devkit';
import { execFileSync, spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { readToml } from './toml';

const require = createRequire(import.meta.url);

/** Hard ceiling on any formatter subprocess so a hung tool cannot stall generation. */
const EXEC_TIMEOUT_MS = 60_000;
/**
 * Seconds uv waits for its global cache lock before giving up. uv serialises
 * cache writes behind a global lock (`<uv cache>/.lock`) and by default waits
 * minutes for it. Capping the wait lets a single attempt ride out transient
 * contention (another uv process installing ruff finishes in seconds) while
 * failing fast if the lock is genuinely stuck, rather than stalling generation.
 */
const UV_LOCK_TIMEOUT_SECONDS = 20;

const uvEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  UV_LOCK_TIMEOUT:
    process.env.UV_LOCK_TIMEOUT ?? String(UV_LOCK_TIMEOUT_SECONDS),
});

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}

/**
 * Run a command with content piped to stdin, resolving at the deadline no
 * matter what the child does. The subprocess runs in its own process group
 * (`detached`) which is SIGKILLed on timeout, so a wedged tool — or any child
 * it spawned (e.g. uv's download workers) — cannot keep the promise pending and
 * stall generation. The timeout timer is `unref`ed so it never keeps the
 * process alive on its own. Resolves with captured output and exit status;
 * rejects only when the command cannot be spawned.
 */
function execWithInput(
  command: string,
  args: string[],
  input: string,
  opts?: { env?: NodeJS.ProcessEnv; cwd?: string },
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: opts?.env,
      cwd: opts?.cwd,
      detached: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: ExecResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      // Kill the whole process group so grandchildren die with the child.
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Process group already gone
      }
      finish({ stdout, stderr, code: null, timedOut: true });
    }, EXEC_TIMEOUT_MS);
    timer.unref();
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) =>
      finish({ stdout, stderr, code, timedOut: false }),
    );
    child.stdin.on('error', () => {}); // Swallow EPIPE if stdin closes early
    child.stdin.end(input);
  });
}

/** Run ruff with the capped uv lock timeout applied. */
function execRuff(argv: string[], input: string): Promise<ExecResult> {
  return execWithInput(argv[0], argv.slice(1), input, { env: uvEnv() });
}

export const DEFAULT_BIOME_CONFIG = {
  $schema: 'https://biomejs.dev/schemas/2.4.16/schema.json',
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
      recommended: false,
      correctness: {
        noUndeclaredDependencies: 'warn',
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
      '!**/*.css',
    ],
  },
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
  const otherFiles = changedFiles.filter((file) =>
    BIOME_FORMATTABLE_EXTENSIONS.has(path.extname(file.path)),
  );

  // Resolve each project's ruff settings (module names, line-length) so files
  // are formatted to match the on-disk build (see getPythonProjectRuffConfigs).
  const pythonProjectConfigs = pyFiles.length
    ? getPythonProjectRuffConfigs(tree)
    : [];

  // Format Python files with ruff (lint fixes + formatting)
  for (const file of pyFiles) {
    try {
      const content = await ruffFixAndFormat(
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
    await formatWithBiomeCli(tree, otherFiles);
  } else {
    formatWithBiomeApi(tree, otherFiles);
  }
}

/**
 * Format files via the workspace's Biome CLI, run from the workspace root so it
 * discovers the on-disk biome.json.
 */
async function formatWithBiomeCli(
  tree: Tree,
  files: { path: string; content: Buffer | null }[],
): Promise<void> {
  const biome = getBiomeCommand(tree.root);
  if (!biome) {
    // Fall back to the library API if the CLI cannot be resolved
    formatWithBiomeApi(tree, files);
    return;
  }

  for (const file of files) {
    try {
      const result = await execWithInput(
        biome.command,
        [...biome.args, 'format', `--stdin-file-path=${file.path}`],
        file.content?.toString('utf-8') ?? '',
        { cwd: tree.root },
      );
      // Only adopt output from a clean exit; a non-zero or killed process may
      // have written nothing or partial content.
      if (result.code === 0) {
        tree.write(file.path, result.stdout);
      }
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
    execFileSync('biome', ['--version'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: EXEC_TIMEOUT_MS,
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
 * Find the ruff command. Tries 'uv run ruff', then 'uvx ruff'.
 * Matches how @nxlv/python runs ruff via the UV provider.
 */
let _ruffCommand: string[] | undefined;
async function getRuffCommand(): Promise<string[] | undefined> {
  if (_ruffCommand !== undefined) {
    return _ruffCommand.length ? _ruffCommand : undefined;
  }
  for (const argv of [
    ['uv', 'run', 'ruff'],
    ['uvx', 'ruff'],
  ]) {
    try {
      const result = await execRuff([...argv, '--version'], '');
      if (result.code === 0) {
        _ruffCommand = argv;
        return argv;
      }
    } catch {
      // Try next command (spawn error, e.g. binary not found)
    }
  }
  _ruffCommand = [];
  return undefined;
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
}

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
        if (modules.length || typeof lineLength === 'number') {
          configs.push({
            root: project.root.split(path.sep).join('/'),
            modules,
            lineLength: typeof lineLength === 'number' ? lineLength : undefined,
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
async function ruffFixAndFormat(
  content: string,
  filePath: string,
  hasConfig: boolean,
  projectConfig?: PythonProjectRuffConfig,
): Promise<string> {
  const ruff = await getRuffCommand();
  if (!ruff) return content;

  const extendSelect = hasConfig ? [] : ['--extend-select', 'I'];
  const configArgs: string[] = [];
  if (projectConfig?.modules.length) {
    configArgs.push(
      '--config',
      `lint.isort.known-first-party = ${JSON.stringify(projectConfig.modules)}`,
    );
  }
  if (typeof projectConfig?.lineLength === 'number') {
    configArgs.push('--config', `line-length = ${projectConfig.lineLength}`);
  }

  // First apply lint fixes (import sorting, unused imports, etc.). ruff check
  // exits non-zero when it finds unfixable issues, but stdout still contains the
  // fixed content, so adopt stdout on any completed run. A killed (timed-out)
  // process may have written only partial content, so never use its output.
  try {
    const result = await execRuff(
      [
        ...ruff,
        'check',
        '--fix',
        ...extendSelect,
        ...configArgs,
        '--stdin-filename',
        filePath,
        '-',
      ],
      content,
    );
    if (!result.timedOut && result.stdout) {
      content = result.stdout;
    }
  } catch {
    // Fall through with whatever content we have (spawn error)
  }

  // Then apply formatting. Only adopt output from a clean exit.
  try {
    const result = await execRuff(
      [...ruff, 'format', ...configArgs, '--stdin-filename', filePath, '-'],
      content,
    );
    if (result.code === 0) {
      content = result.stdout;
    }
  } catch {
    // Fall through with whatever content we have
  }

  return content;
}
