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
  updateJson,
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
 * Contains solution-deploy and solution-destroy bin scripts that resolve
 * credentials from infra-config and call CDK. Can be extended with other
 * build-time scripts in the future.
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

  // Add bin entries to package.json so solution-deploy/solution-destroy
  // appear in node_modules/.bin/ after install.
  // The tsProjectGenerator may delete the package.json for workspace projects,
  // so we create it if it doesn't exist.
  const pkgJsonPath = joinPathFragments(scriptsDir, 'package.json');
  if (!tree.exists(pkgJsonPath)) {
    tree.write(
      pkgJsonPath,
      JSON.stringify(
        {
          name: `${npmScopePrefix}${SHARED_SCRIPTS_NAME}`,
          version: '0.0.0',
          type: 'module',
          bin: {
            'solution-deploy': './src/solution-deploy.ts',
            'solution-destroy': './src/solution-destroy.ts',
          },
        },
        null,
        2,
      ),
    );
  } else {
    updateJson(tree, pkgJsonPath, (pkg) => ({
      ...pkg,
      bin: {
        'solution-deploy': './src/solution-deploy.ts',
        'solution-destroy': './src/solution-destroy.ts',
      },
    }));
  }

  // Add @aws-sdk/client-sts as a dependency of this package
  // (used by the assumeRole credential strategy)
  addDependenciesToPackageJson(tree, withVersions(['@aws-sdk/client-sts']), {});

  // Register as a workspace dependency so the bin scripts are linked
  // to node_modules/.bin/ and available to all projects
  addDependenciesToPackageJson(
    tree,
    { [`${npmScopePrefix}${SHARED_SCRIPTS_NAME}`]: 'workspace:*' },
    {},
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
