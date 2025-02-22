/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import TOML from '@iarna/toml';

/**
 * Update a toml file
 */
export const updateToml = (
  tree: Tree,
  filePath: string,
  updater: (prev: TOML.JsonMap) => TOML.JsonMap,
) => {
  const prev = readToml(tree, filePath);
  tree.write(filePath, TOML.stringify(updater(prev)));
};

/**
 * Read a toml file
 */
export const readToml = (tree: Tree, filePath: string): TOML.JsonMap => {
  if (!tree.exists(filePath)) {
    throw new Error(`${filePath} does not exist`);
  }
  return TOML.parse(tree.read(filePath, 'utf-8'));
};
