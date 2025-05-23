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
  TYPE_DEFINITIONS_DIR,
  TYPE_DEFINITIONS_NAME,
  SHARED_CONSTRUCTS_DIR,
  SHARED_CONSTRUCTS_NAME,
} from './shared-constructs-constants';

export async function sharedConstructsGenerator(tree: Tree) {
  const npmScopePrefix = getNpmScopePrefix(tree);
  updateGitignore(tree);

  if (
    !tree.exists(
      joinPathFragments(PACKAGES_DIR, TYPE_DEFINITIONS_DIR, 'project.json'),
    )
  ) {
    await tsProjectGenerator(tree, {
      name: TYPE_DEFINITIONS_NAME,
      directory: PACKAGES_DIR,
      subDirectory: TYPE_DEFINITIONS_DIR,
    });
    tree.delete(joinPathFragments(PACKAGES_DIR, TYPE_DEFINITIONS_DIR, 'src'));
    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files', TYPE_DEFINITIONS_DIR, 'src'),
      joinPathFragments(PACKAGES_DIR, TYPE_DEFINITIONS_DIR, 'src'),
      {
        npmScopePrefix,
      },
      {
        overwriteStrategy: OverwriteStrategy.KeepExisting,
      },
    );
    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files', 'common', 'readme'),
      joinPathFragments(PACKAGES_DIR, TYPE_DEFINITIONS_DIR),
      {
        fullyQualifiedName: `${npmScopePrefix}${TYPE_DEFINITIONS_NAME}`,
        name: TYPE_DEFINITIONS_NAME,
        pkgMgrCmd: getPackageManagerCommand().exec,
      },
      {
        overwriteStrategy: OverwriteStrategy.Overwrite,
      },
    );
    await formatFilesInSubtree(tree);
  }
  if (
    !tree.exists(
      joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'project.json'),
    )
  ) {
    await tsProjectGenerator(tree, {
      name: SHARED_CONSTRUCTS_NAME,
      directory: PACKAGES_DIR,
      subDirectory: SHARED_CONSTRUCTS_DIR,
    });
    tree.delete(joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'src'));
    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files', SHARED_CONSTRUCTS_DIR, 'src'),
      joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'src'),
      {
        npmScopePrefix,
        scopeAlias: toScopeAlias(npmScopePrefix),
      },
      {
        overwriteStrategy: OverwriteStrategy.KeepExisting,
      },
    );
    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files', 'common', 'readme'),
      joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR),
      {
        fullyQualifiedName: `${npmScopePrefix}${SHARED_CONSTRUCTS_NAME}`,
        name: SHARED_CONSTRUCTS_NAME,
        pkgMgrCmd: getPackageManagerCommand().exec,
      },
      {
        overwriteStrategy: OverwriteStrategy.Overwrite,
      },
    );
    addDependenciesToPackageJson(
      tree,
      withVersions(['constructs', 'aws-cdk-lib']),
      withVersions(['@types/node']),
    );
    await formatFilesInSubtree(tree);
  }
}

const updateGitignore = (tree: Tree) => {
  const gitignore = tree.exists('.gitignore')
    ? tree.read('.gitignore', 'utf-8')
    : '';
  const regex = /runtime-config.json/gm;
  const hasRuntimeConfig = regex.test(gitignore ?? '');
  if (hasRuntimeConfig) {
    return;
  }
  tree.write('.gitignore', `${gitignore}\n\nruntime-config.json`);
};
