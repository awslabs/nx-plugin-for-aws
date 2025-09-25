/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addDependenciesToPackageJson, Tree } from '@nx/devkit';
import { withVersions } from './versions';

/**
 * Utility class for creating platform agnostic commands for filesystem operations.
 * Adds the required dependencies to the root package json
 */
export class FsCommands {
  private tree: Tree;

  constructor(tree: Tree) {
    this.tree = tree;
  }

  public cp(src: string, dst: string) {
    addDependenciesToPackageJson(this.tree, {}, withVersions(['ncp']));
    return `ncp ${src} ${dst}`;
  }

  public rm(dir: string) {
    addDependenciesToPackageJson(this.tree, {}, withVersions(['rimraf']));
    return `rimraf ${dir}`;
  }

  public mkdir(dir: string) {
    addDependenciesToPackageJson(this.tree, {}, withVersions(['make-dir-cli']));
    return `make-dir ${dir}`;
  }
}
