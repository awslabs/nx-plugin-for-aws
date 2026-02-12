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
import { getNpmScopePrefix } from './npm-scope';
import tsProjectGenerator from '../ts/lib/generator';
import { formatFilesInSubtree } from './format';
import {
  PACKAGES_DIR,
  SHARED_INFRA_CONFIG_NAME,
  SHARED_INFRA_CONFIG_DIR,
} from './shared-constructs-constants';

/**
 * Lazily creates the shared infra-config package at packages/common/infra-config/.
 * Contains stage configuration types and the user's stage-to-credential mappings.
 * Importable from any package via scope alias.
 */
export async function sharedInfraConfigGenerator(tree: Tree): Promise<void> {
  const configDir = joinPathFragments(PACKAGES_DIR, SHARED_INFRA_CONFIG_DIR);

  // Don't recreate if it already exists
  if (tree.exists(joinPathFragments(configDir, 'project.json'))) {
    return;
  }

  const npmScopePrefix = getNpmScopePrefix(tree);

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
    {},
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
      pkgMgrCmd: getPackageManagerCommand().exec,
    },
    { overwriteStrategy: OverwriteStrategy.Overwrite },
  );

  // Ensure package.json exists (tsProjectGenerator may delete it for workspace projects)
  const pkgJsonPath = joinPathFragments(configDir, 'package.json');
  if (!tree.exists(pkgJsonPath)) {
    tree.write(
      pkgJsonPath,
      JSON.stringify(
        {
          name: `${npmScopePrefix}${SHARED_INFRA_CONFIG_NAME}`,
          version: '0.0.0',
          type: 'module',
          main: './src/index.ts',
        },
        null,
        2,
      ),
    );
  }

  // Register as a workspace dependency so it's importable from any package
  addDependenciesToPackageJson(
    tree,
    { [`${npmScopePrefix}${SHARED_INFRA_CONFIG_NAME}`]: 'workspace:*' },
    {},
  );

  await formatFilesInSubtree(tree);
}
