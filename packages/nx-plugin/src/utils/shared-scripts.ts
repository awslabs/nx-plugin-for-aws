/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  generateFiles,
  getPackageManagerCommand,
  joinPathFragments,
  OverwriteStrategy,
  Tree,
} from '@nx/devkit';
import { getNpmScopePrefix, toScopeAlias } from './npm-scope';
import tsProjectGenerator from '../ts/lib/generator';
import { withVersions } from './versions';
import { formatFilesInSubtree } from './format';
import {
  PACKAGES_DIR,
  SHARED_SCRIPTS_NAME,
  SHARED_SCRIPTS_DIR,
} from './shared-constructs-constants';

/**
 * Lazily creates the shared scripts package at packages/common/scripts/.
 * Contains infra-deploy and infra-destroy scripts that resolve
 * credentials from infra-config and call CDK.
 * Invoked via `tsx packages/common/scripts/src/infra-deploy.ts` from NX targets.
 */
export async function sharedScriptsGenerator(tree: Tree): Promise<void> {
  const scriptsDir = joinPathFragments(PACKAGES_DIR, SHARED_SCRIPTS_DIR);

  // Don't recreate if it already exists
  if (tree.exists(joinPathFragments(scriptsDir, 'project.json'))) {
    return;
  }

  const npmScopePrefix = getNpmScopePrefix(tree);
  const scopeAlias = toScopeAlias(npmScopePrefix);

  await tsProjectGenerator(tree, {
    name: SHARED_SCRIPTS_NAME,
    directory: PACKAGES_DIR,
    subDirectory: SHARED_SCRIPTS_DIR,
  });

  // Replace default src/ with our templates
  tree.delete(joinPathFragments(scriptsDir, 'src'));
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', SHARED_SCRIPTS_DIR, 'src'),
    joinPathFragments(scriptsDir, 'src'),
    { scopeAlias },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Add AWS SDK deps as dev dependencies (used by deploy-time scripts for assumeRole)
  addDependenciesToPackageJson(
    tree,
    {},
    withVersions(['@aws-sdk/client-sts', '@aws-sdk/credential-providers']),
  );

  // Generate README
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'common', 'readme'),
    scriptsDir,
    {
      fullyQualifiedName: `${npmScopePrefix}${SHARED_SCRIPTS_NAME}`,
      name: SHARED_SCRIPTS_NAME,
      pkgMgrCmd: getPackageManagerCommand().exec,
    },
    { overwriteStrategy: OverwriteStrategy.Overwrite },
  );

  await formatFilesInSubtree(tree);
}
