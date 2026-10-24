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
import { esmVars } from './module-format.js';
import {
  PACKAGES_DIR,
  SHARED_SCRIPTS_DIR,
} from './shared-constructs-constants.js';
import { ensureSharedScriptsProject } from './shared-scripts.js';
import { type ITsDepVersion, withVersions } from './versions.js';

/** Dependencies a caller must declare to use the shared Greengrass scripts. */
export const SHARED_GREENGRASS_SCRIPTS_DEPENDENCIES = [
  { name: 'js-yaml' },
  { name: '@types/js-yaml' },
  { name: 'tsx' },
] as const satisfies readonly { name: ITsDepVersion }[];

/**
 * Ensures the shared scripts package exists and adds Greengrass local-build
 * and local-deploy scripts to packages/common/scripts/src/greengrass/. Used
 * by greengrass#component for Python and TypeScript hosts so a
 * single set of TypeScript scripts serves both.
 */
export async function sharedGreengrassScriptsGenerator<
  const D extends DependencyDeclaration,
>(
  tree: Tree,
  declaration: D &
    MustDeclare<typeof SHARED_GREENGRASS_SCRIPTS_DEPENDENCIES, D>,
): Promise<void> {
  const scriptsDir = joinPathFragments(PACKAGES_DIR, SHARED_SCRIPTS_DIR);
  const greengrassScriptsDir = joinPathFragments(
    scriptsDir,
    'src',
    'greengrass',
  );

  await ensureSharedScriptsProject(tree);

  generateFiles(
    tree,
    joinPathFragments(
      import.meta.dirname,
      'files',
      SHARED_SCRIPTS_DIR,
      'src',
      'greengrass',
    ),
    greengrassScriptsDir,
    esmVars(tree),
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  addDependenciesToPackageJson(
    tree,
    withVersions(
      declaration as DependencyDeclaration<
        typeof SHARED_GREENGRASS_SCRIPTS_DEPENDENCIES
      >,
      ['js-yaml'],
    ),
    withVersions(
      declaration as DependencyDeclaration<
        typeof SHARED_GREENGRASS_SCRIPTS_DEPENDENCIES
      >,
      ['@types/js-yaml'],
    ),
    joinPathFragments(PACKAGES_DIR, SHARED_SCRIPTS_DIR, 'package.json'),
  );
  addDependenciesToPackageJson(
    tree,
    {},
    withVersions(
      declaration as DependencyDeclaration<
        typeof SHARED_GREENGRASS_SCRIPTS_DEPENDENCIES
      >,
      ['tsx'],
    ),
  );
}
