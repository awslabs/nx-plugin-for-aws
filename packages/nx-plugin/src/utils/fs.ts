/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import {
  type DependencyDeclaration,
  forDependencies,
  type MustDeclare,
} from './declared-dependencies.js';
import { addDependenciesToPackageJson } from './dependencies.js';
import { type ITsDepVersion, withVersions } from './versions.js';

/** Dependencies a caller must declare to use `FsCommands`. */
export const FS_DEPENDENCIES = [{ name: 'shx' }] as const satisfies readonly {
  name: ITsDepVersion;
}[];

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

  /** Copy a single file to `dst`, which names the file rather than a directory. */
  public cpFile(src: string, dst: string) {
    this.add('shx');
    return `shx cp ${src} ${dst}`;
  }

  /**
   * Copy a directory's contents into `dst`, merging into whatever is already
   * there.
   *
   * The trailing `/.` is load bearing: `shx cp -R src dst` follows POSIX `cp`,
   * which nests `src` *inside* an existing `dst` rather than merging into it, so
   * without it a copy into a directory a preceding `mkdir` had just created
   * would land a level too deep. `src/.` copies the contents, and unlike a
   * `src/*` glob it includes dotfiles — which `node_modules/.bin` depends on.
   */
  public cpDir(src: string, dst: string) {
    this.add('shx');
    return `shx cp -R ${src}/. ${dst}`;
  }

  public rm(dir: string) {
    this.add('shx');
    return `shx rm -rf ${dir}`;
  }

  public mkdir(dir: string) {
    this.add('shx');
    return `shx mkdir -p ${dir}`;
  }

  /**
   * Copy the single file a glob matches to `dstDir/dstFileName`, for an artifact
   * whose producer names it — the Smithy OpenAPI plugin writes
   * `<ServiceShape>.openapi.json`. Fails rather than silently doing nothing when
   * the glob matches nothing, or when it matches more than one file.
   *
   * `dstDir` is created first: `shx cp` writes through to a named destination
   * file and fails if its parent is missing.
   */
  public cpGlobToFile(srcGlob: string, dstDir: string, dstFileName: string) {
    this.add('shx');
    return `shx mkdir -p ${dstDir} && shx cp "${srcGlob}" ${dstDir}/${dstFileName}`;
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
