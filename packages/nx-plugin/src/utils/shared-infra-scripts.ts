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
} from './declared-dependencies';
import { addDependenciesToPackageJson } from './dependencies';
import { formatFilesInSubtree } from './format';
import { esmVars } from './module-format';
import { getNpmScopePrefix } from './npm-scope';
import { getPackageManagerDisplayCommands } from './pkg-manager';
import {
  generatedInfrastructure,
  PACKAGES_DIR,
  SHARED_SCRIPTS_DIR,
  SHARED_SCRIPTS_NAME,
} from './shared-constructs-constants';
import { ensureSharedScriptsProject } from './shared-scripts';
import { withVersions } from './versions';

/**
 * Dependencies a caller must declare to use the shared infra scripts.
 *
 * Gated on infrastructure having been generated, since the scripts project is
 * only created on that branch.
 */
export const SHARED_INFRA_SCRIPTS_DEPENDENCIES = [
  { name: '@aws-sdk/client-sts', when: generatedInfrastructure },
  { name: '@aws-sdk/credential-providers', when: generatedInfrastructure },
] as const;

/**
 * Ensures the shared scripts package exists and adds infra-deploy/infra-destroy
 * scripts to packages/common/scripts/src/infra/. Called by ts#infra when
 * stageConfig is enabled.
 */
export async function sharedInfraScriptsGenerator<
  const D extends DependencyDeclaration,
>(
  tree: Tree,
  declaration: D & MustDeclare<typeof SHARED_INFRA_SCRIPTS_DEPENDENCIES, D>,
): Promise<void> {
  const scriptsDir = joinPathFragments(PACKAGES_DIR, SHARED_SCRIPTS_DIR);

  await ensureSharedScriptsProject(tree);

  const npmScopePrefix = getNpmScopePrefix(tree);
  const scopeAlias = npmScopePrefix;

  generateFiles(
    tree,
    joinPathFragments(
      import.meta.dirname,
      'files',
      SHARED_SCRIPTS_DIR,
      'src',
      'infra',
    ),
    joinPathFragments(scriptsDir, 'src', 'infra'),
    { scopeAlias, ...esmVars(tree) },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Used by deploy-time scripts for assumeRole
  addDependenciesToPackageJson(
    tree,
    {},
    withVersions(
      declaration as DependencyDeclaration<
        typeof SHARED_INFRA_SCRIPTS_DEPENDENCIES
      >,
      ['@aws-sdk/client-sts', '@aws-sdk/credential-providers'],
    ),
    joinPathFragments(
      joinPathFragments(PACKAGES_DIR, SHARED_SCRIPTS_DIR),
      'package.json',
    ),
  );

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'common', 'readme'),
    scriptsDir,
    {
      fullyQualifiedName: `${npmScopePrefix}${SHARED_SCRIPTS_NAME}`,
      name: SHARED_SCRIPTS_NAME,
      pkgMgrCmd: getPackageManagerDisplayCommands().exec,
    },
    { overwriteStrategy: OverwriteStrategy.Overwrite },
  );

  await formatFilesInSubtree(tree);
}
