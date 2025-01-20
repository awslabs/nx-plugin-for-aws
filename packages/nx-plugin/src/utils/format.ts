/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, Tree } from '@nx/devkit';
import path from 'path';
import type * as Prettier from 'prettier';
/**
 * Format files in the given directory within the tree
 * See https://github.com/nrwl/nx/blob/4cd640a9187954505d12de5b6d76a90d8ce4c2eb/packages/devkit/src/generators/format-files.ts#L11
 */
export async function formatFilesInSubtree(
  tree: Tree,
  dir: string
): Promise<void> {
  let prettier: typeof Prettier;
  try {
    prettier = await import('prettier');
  } catch {
    // Skip formatting if pretter cannot be imported
    return;
  }
  const files = new Set(
    tree
      .listChanges()
      .filter((file) => file.type !== 'DELETE')
      .filter((file) => file.path.startsWith(dir))
  );
  const changedPrettierInTree = getChangedPrettierConfigInTree(tree);
  await Promise.all(
    Array.from(files).map(async (file) => {
      try {
        const systemPath = path.join(tree.root, file.path);
        const resolvedOptions = await prettier.resolveConfig(systemPath, {
          editorconfig: true,
        });
        const options: Prettier.Options = {
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
            | string)
        );
      } catch (e) {
        console.warn(`Could not format ${file.path}. Error: "${e.message}"`);
      }
    })
  );
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
