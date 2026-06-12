/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Biome } from '@biomejs/js-api/nodejs';
import type { Tree } from '@nx/devkit';
import { execFileSync, execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

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

  // Format Python files with ruff (lint fixes + formatting). Ruff resolves
  // its config (and isort defaults like `I`) by walking up from the file
  // path on disk, and `uv run` resolves the workspace from cwd — both must
  // be anchored at tree.root for per-project pyproject.toml configs to apply.
  for (const file of pyFiles) {
    try {
      const content = ruffFixAndFormat(
        file.content.toString('utf-8'),
        file.path,
        tree.root,
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
      paths: [root, __dirname],
    });
    const pkgJson = require(pkgJsonPath);
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
 * Run a single ruff stdin invocation. Returns the transformed content on
 * success, or `undefined` if ruff couldn't run cleanly. `ruff check --fix`
 * exits non-zero on unfixable findings while still emitting fixed content
 * on stdout, so we accept that case and treat it as success — but distinguish
 * it from "ruff itself failed to start" (uv couldn't resolve the workspace
 * and short-circuited before running ruff, leaving the file unchanged on
 * stdout while a workspace error is on stderr).
 *
 * `cwd` must be the workspace root and `stdinFilename` must be the absolute
 * path to the file: ruff resolves config (and isort defaults like `I`) by
 * walking up from the file path on disk, and `uv run` resolves the workspace
 * from `cwd`. Mismatches between these and the in-memory tree state cause
 * ruff to fall back to default rules (no import sorting), which silently
 * leaves I001 in the output.
 */
const tryRuff = (
  cmd: string,
  args: string,
  input: string,
  cwd: string,
  stdinFilename: string,
): string | undefined => {
  let stdout = '';
  let stderr = '';
  try {
    stdout = execSync(`${cmd} ${args} --stdin-filename ${stdinFilename} -`, {
      input,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
    });
  } catch (e: any) {
    stdout = (e.stdout ?? '').toString();
    stderr = (e.stderr ?? '').toString();
  }
  // `uv run` emits a workspace-resolution error to stderr but still passes
  // the unmodified input through to stdout; treat this as a failure so the
  // caller can fall back to a workspace-independent invocation (`uvx`).
  if (/Failed to (build|parse) `/.test(stderr)) {
    return undefined;
  }
  return stdout || undefined;
};

/**
 * Run ruff check --fix and ruff format on Python file content via stdin.
 * Applies all configured lint fixes (including import sorting) and
 * formatting.
 *
 * Tries `uv run ruff` first so the workspace's installed ruff version is
 * used; falls back to `uvx ruff@<pinned>` when `uv run` can't resolve the
 * workspace (transient state during generation: the in-memory tree's
 * workspace pyproject.toml has not yet been flushed, so `uv run` from the
 * workspace root sees a stale workspace and emits the file unchanged on
 * stdout). The fallback pins ruff to a known-good version so generator
 * output is reproducible regardless of the user's `uvx` cache.
 *
 * Both invocations still pick up per-project ruff config — they walk up
 * from the stdin filename's directory on disk, which is what makes import
 * sorting (`I`) apply.
 */
const PINNED_RUFF = 'ruff@0.15.17';

function ruffFixAndFormat(
  content: string,
  filePath: string,
  cwd: string,
): string {
  const stdinFilename = path.isAbsolute(filePath)
    ? filePath
    : path.join(cwd, filePath);
  // `--extend-select=I` enables the isort rules even when the file's
  // project pyproject.toml has not yet been written to disk (a freshly
  // generated project is still only in the in-memory tree at format time,
  // so ruff falls back to its default ruleset which excludes `I`).
  for (const cmd of ['uv run ruff', `uvx ${PINNED_RUFF}`]) {
    // First apply lint fixes (import sorting, unused imports, etc.)
    const fixed = tryRuff(
      cmd,
      'check --fix --extend-select=I',
      content,
      cwd,
      stdinFilename,
    );
    if (fixed === undefined) continue;
    // Then apply formatting
    const formatted = tryRuff(cmd, 'format', fixed, cwd, stdinFilename);
    return formatted ?? fixed;
  }
  return content;
}
