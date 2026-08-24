/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
} from '@nx/devkit';
import type {
  DependencyDeclaration,
  MustDeclare,
} from './declared-dependencies.js';
import { addDependenciesToPackageJson } from './dependencies.js';
import {
  PACKAGES_DIR,
  SHARED_SCRIPTS_DIR,
} from './shared-constructs-constants.js';
import { ensureSharedScriptsProject } from './shared-scripts.js';
import { type ITsDepVersion, withVersions } from './versions.js';

/** Dependencies a caller must declare to use the shared RDB scripts. */
export const SHARED_RDB_SCRIPTS_DEPENDENCIES = [
  { name: 'pg' },
  { name: '@types/pg' },
  { name: 'mariadb' },
  { name: 'tsx' },
] as const satisfies readonly { name: ITsDepVersion }[];

/**
 * Ensures the shared scripts package exists and adds RDB local-dev scripts
 * to packages/common/scripts/src/rdb/. Used by ts#rdb.
 *
 * Engine-agnostic scripts (pull-image, start-container) are always vended.
 * Only the wait-for-db script for the requested engine is vended so that
 * projects do not reference database client packages they don't install.
 * The engine-specific file names allow postgres and mysql projects to
 * coexist in the same workspace.
 */
export async function sharedRdbScriptsGenerator<
  const D extends DependencyDeclaration,
>(
  tree: Tree,
  engine: 'postgres' | 'mysql',
  declaration: D & MustDeclare<typeof SHARED_RDB_SCRIPTS_DEPENDENCIES, D>,
): Promise<void> {
  await ensureSharedScriptsProject(tree);

  const rdbScriptsDir = joinPathFragments(
    import.meta.dirname,
    'files',
    SHARED_SCRIPTS_DIR,
    'src',
    'rdb',
  );
  const targetDir = joinPathFragments(
    PACKAGES_DIR,
    SHARED_SCRIPTS_DIR,
    'src',
    'rdb',
  );

  generateFiles(
    tree,
    joinPathFragments(rdbScriptsDir, 'shared'),
    targetDir,
    {},
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );
  generateFiles(
    tree,
    joinPathFragments(rdbScriptsDir, engine),
    targetDir,
    {},
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // The engine's wait-for-db script imports the database client, so declare it
  // in the scripts project's own package.json (tsx runs the scripts and lives
  // in the workspace root devDependencies).
  const clientDeps: (typeof SHARED_RDB_SCRIPTS_DEPENDENCIES)[number]['name'][] =
    engine === 'postgres' ? ['pg'] : ['mariadb'];
  const clientDevDeps: (typeof SHARED_RDB_SCRIPTS_DEPENDENCIES)[number]['name'][] =
    engine === 'postgres' ? ['@types/pg'] : [];
  addDependenciesToPackageJson(
    tree,
    withVersions(
      declaration as DependencyDeclaration<
        typeof SHARED_RDB_SCRIPTS_DEPENDENCIES
      >,
      clientDeps,
    ),
    withVersions(
      declaration as DependencyDeclaration<
        typeof SHARED_RDB_SCRIPTS_DEPENDENCIES
      >,
      clientDevDeps,
    ),
    joinPathFragments(PACKAGES_DIR, SHARED_SCRIPTS_DIR, 'package.json'),
  );
  addDependenciesToPackageJson(
    tree,
    {},
    withVersions(
      declaration as DependencyDeclaration<
        typeof SHARED_RDB_SCRIPTS_DEPENDENCIES
      >,
      ['tsx'],
    ),
  );
}
