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
  if (!tree.exists(filePath)) {
    throw new Error(`Cannot update toml file ${filePath} as it does not exist`);
  }
  const prev = TOML.parse(tree.read(filePath, 'utf-8'));
  tree.write(filePath, TOML.stringify(updater(prev)));
};
