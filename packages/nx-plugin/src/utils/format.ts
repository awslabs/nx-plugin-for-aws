/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Biome } from '@biomejs/js-api/nodejs';
import type { Tree } from '@nx/devkit';
import { execFileSync, execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);

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

  // Format Python files with ruff (lint fixes + formatting)
  for (const file of pyFiles) {
    try {
      const content = ruffFixAndFormat(
        file.content.toString('utf-8'),
        file.path,
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
 * Find the ruff command. Tries 'uv run ruff', then 'uvx ruff'.
 * Matches how @nxlv/python runs ruff via the UV provider.
 */
let _ruffCommand: string | undefined;
function getRuffCommand(): string | undefined {
  if (_ruffCommand !== undefined) {
    return _ruffCommand || undefined;
  }
  for (const cmd of ['uv run ruff', 'uvx ruff']) {
    try {
      execSync(`${cmd} --version`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      _ruffCommand = cmd;
      return cmd;
    } catch {
      // Try next command
    }
  }
  _ruffCommand = '';
  return undefined;
}

/**
 * Run ruff check --fix and ruff format on Python file content via stdin.
 * Applies all configured lint fixes (including import sorting) and formatting.
 */
function ruffFixAndFormat(content: string, filePath: string): string {
  const ruff = getRuffCommand();
  if (!ruff) return content;

  // First apply lint fixes (import sorting, unused imports, etc.). During
  // generation the file is in the virtual tree, not on disk, so ruff cannot
  // discover the project's config and falls back to defaults — which omit
  // isort. `--extend-select I` adds import sorting on top of those defaults so
  // the output matches what the project's build (which enables `I`) enforces.
  try {
    const result = execSync(
      `${ruff} check --fix --extend-select I --stdin-filename ${filePath} -`,
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
    content = execSync(`${ruff} format --stdin-filename ${filePath} -`, {
      input: content,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    // Fall through with whatever content we have
  }

  return content;
}
