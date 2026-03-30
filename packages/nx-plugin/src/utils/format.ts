/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, Tree } from '@nx/devkit';
import path from 'path';
import type * as Prettier from 'prettier';
import { execSync } from 'child_process';

/**
 * Format files in the given directory within the tree.
 * Handles both TypeScript/JavaScript (via prettier) and Python (via ruff) files.
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
  const otherFiles = changedFiles.filter((file) => !file.path.endsWith('.py'));

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

  // Format other files with prettier
  let prettier: typeof Prettier;
  try {
    prettier = await import('prettier');
  } catch {
    // Skip formatting if prettier cannot be imported
    return;
  }
  const changedPrettierInTree = getChangedPrettierConfigInTree(tree);
  await Promise.all(
    otherFiles.map(async (file) => {
      try {
        const systemPath = path.join(tree.root, file.path);
        const resolvedOptions = await prettier.resolveConfig(systemPath, {
          editorconfig: true,
        });
        const options: Prettier.Options = {
          trailingComma: 'all',
          ...resolvedOptions,
          ...changedPrettierInTree,
          filepath: systemPath,
        };
        const support = await prettier.getFileInfo(systemPath, options as any);
        if (support.ignored || !support.inferredParser) {
          return;
        }

        tree.write(
          file.path,
          // In prettier v3 the format result is a promise
          await (prettier.format(file.content.toString('utf-8'), options) as
            | Promise<string>
            | string),
        );
      } catch (e) {
        console.warn(`Could not format ${file.path}. Error: "${e.message}"`);
      }
    }),
  );
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

  // First apply lint fixes (import sorting, unused imports, etc.)
  try {
    const result = execSync(
      `${ruff} check --fix --stdin-filename ${filePath} -`,
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
function getChangedPrettierConfigInTree(tree: Tree): Prettier.Options | null {
  if (tree.listChanges().find((file) => file.path === '.prettierrc')) {
    try {
      return readJson(tree, '.prettierrc');
    } catch {
      return null;
    }
  } else {
    return null;
  }
}
