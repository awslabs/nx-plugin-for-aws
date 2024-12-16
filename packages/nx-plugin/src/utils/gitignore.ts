/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from "@nx/devkit";
import { join } from "path";
import { uniq } from "./string";

export const updateGitIgnore = (tree: Tree, dir: string, doUpdate: (patterns: string[]) => string[]) => {
  const gitIgnorePath = join(dir, '.gitignore');
  const existingPatterns = tree.read(gitIgnorePath, 'utf-8')?.split('\n') ?? [];
  const newPatterns = doUpdate(existingPatterns);
  tree.write(gitIgnorePath, uniq(newPatterns).join('\n'));
};
