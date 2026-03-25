/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  Tree,
} from '@nx/devkit';
import { getNpmScopePrefix } from './npm-scope';
import tsProjectGenerator from '../ts/lib/generator';
import { formatFilesInSubtree } from './format';
import { getPackageManagerDisplayCommands } from './pkg-manager';
import {
  PACKAGES_DIR,
  SHARED_INFRA_CONFIG_NAME,
  SHARED_INFRA_CONFIG_DIR,
} from './shared-constructs-constants';

/**
 * Lazily creates the shared infra-config package at packages/common/infra-config/.
 * Contains stage configuration types and the user's stage-to-credential mappings.
 * Importable from any package via ts project references.
 */
export async function sharedInfraConfigGenerator(tree: Tree): Promise<void> {
  const configDir = joinPathFragments(PACKAGES_DIR, SHARED_INFRA_CONFIG_DIR);

  // Don't recreate if it already exists
  if (tree.exists(joinPathFragments(configDir, 'project.json'))) {
    return;
  }

  const npmScopePrefix = getNpmScopePrefix(tree);
  const displayCmds = getPackageManagerDisplayCommands();

  await tsProjectGenerator(tree, {
    name: SHARED_INFRA_CONFIG_NAME,
    directory: PACKAGES_DIR,
    subDirectory: SHARED_INFRA_CONFIG_DIR,
  });

  // Replace default src/ with our templates
  tree.delete(joinPathFragments(configDir, 'src'));
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', SHARED_INFRA_CONFIG_DIR, 'src'),
    joinPathFragments(configDir, 'src'),
    {
      pkgMgrRunNx: `${displayCmds.exec} nx`,
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Generate README
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'common', 'readme'),
    configDir,
    {
      fullyQualifiedName: `${npmScopePrefix}${SHARED_INFRA_CONFIG_NAME}`,
      name: SHARED_INFRA_CONFIG_NAME,
      pkgMgrCmd: displayCmds.exec,
    },
    { overwriteStrategy: OverwriteStrategy.Overwrite },
  );

  await formatFilesInSubtree(tree);
}
