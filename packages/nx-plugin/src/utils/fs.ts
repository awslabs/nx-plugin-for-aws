/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import {
  type DependencyDeclaration,
  forDependencies,
  type MustDeclare,
} from './declared-dependencies';
import { addDependenciesToPackageJson } from './dependencies';
import { type ITsDepVersion, withVersions } from './versions';

/** Dependencies a caller must declare to use `FsCommands`. */
export const FS_DEPENDENCIES = [
  { name: 'ncp' },
  { name: 'rimraf' },
  { name: 'make-dir-cli' },
  { name: 'cpy-cli' },
] as const satisfies readonly { name: ITsDepVersion }[];

/**
 * Platform agnostic commands for filesystem operations, adding the CLIs they
 * need to the root package.json.
 */
export class FsCommands<D extends DependencyDeclaration> {
  private tree: Tree;
  private declaration: D;

  constructor(
    tree: Tree,
    declaration: D & MustDeclare<typeof FS_DEPENDENCIES, D>,
  ) {
    this.tree = tree;
    this.declaration = declaration;
  }

  public cp(src: string, dst: string) {
    this.add('ncp');
    return `ncp ${src} ${dst}`;
  }

  public rm(dir: string) {
    this.add('rimraf');
    return `rimraf ${dir}`;
  }

  public mkdir(dir: string) {
    this.add('make-dir-cli');
    return `make-dir ${dir}`;
  }

  /**
   * Copy the single file a glob matches to `dst`, for an artifact whose producer
   * names it — the Smithy OpenAPI plugin writes `<ServiceShape>.openapi.json`.
   * Fails rather than silently doing nothing when the glob matches nothing.
   */
  public cpGlobToFile(srcGlob: string, dstDir: string, dstFileName: string) {
    this.add('cpy-cli');
    return `cpy "${srcGlob}" ${dstDir} --flat --rename=${dstFileName}`;
  }

  private add(dep: (typeof FS_DEPENDENCIES)[number]['name']) {
    addDependenciesToPackageJson(
      this.tree,
      {},
      withVersions(forDependencies<typeof FS_DEPENDENCIES>(this.declaration), [
        dep,
      ]),
    );
  }
}
