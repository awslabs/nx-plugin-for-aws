/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, type Tree } from '@nx/devkit';
export function getNpmScope(tree: Tree): string | undefined {
  const { name } = tree.exists('package.json')
    ? readJson<{
        name?: string;
      }>(tree, 'package.json')
    : { name: null };
  return name?.startsWith('@') ? name.split('/')[0].substring(1) : 'monorepo';
}
export function getNpmScopePrefix(tree: Tree): string | undefined {
  const npmScope = getNpmScope(tree);
  return `@${npmScope}/`;
}
