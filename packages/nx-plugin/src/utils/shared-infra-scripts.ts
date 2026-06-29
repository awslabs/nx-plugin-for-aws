/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
} from '@nx/devkit';
import { formatFilesInSubtree } from './format';
import { getNpmScopePrefix, toScopeAlias } from './npm-scope';
import { getPackageManagerDisplayCommands } from './pkg-manager';
import {
  PACKAGES_DIR,
  SHARED_SCRIPTS_DIR,
  SHARED_SCRIPTS_NAME,
} from './shared-constructs-constants';
import { ensureSharedScriptsProject } from './shared-scripts';
import { withVersions } from './versions';

/**
 * Ensures the shared scripts package exists and adds infra-deploy/infra-destroy
 * scripts to packages/common/scripts/src/infra/. Called by ts#infra when
 * stageConfig is enabled.
 */
export async function sharedInfraScriptsGenerator(tree: Tree): Promise<void> {
  const scriptsDir = joinPathFragments(PACKAGES_DIR, SHARED_SCRIPTS_DIR);

  await ensureSharedScriptsProject(tree);

  const npmScopePrefix = getNpmScopePrefix(tree);
  const scopeAlias = toScopeAlias(npmScopePrefix);

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
    { scopeAlias },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Used by deploy-time scripts for assumeRole
  addDependenciesToPackageJson(
    tree,
    {},
    withVersions(['@aws-sdk/client-sts', '@aws-sdk/credential-providers']),
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
