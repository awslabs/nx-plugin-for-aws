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
import terraformProjectGenerator from '../terraform/project/generator';
import { withVersions } from './versions';
import { formatFilesInSubtree } from './format';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_CONSTRUCTS_NAME,
  SHARED_TERRAFORM_DIR,
  SHARED_TERRAFORM_NAME,
} from './shared-constructs-constants';
import { readAwsNxPluginConfig } from './config/utils';

export interface SharedConstructsGeneratorOptions {
  iacProvider?: 'CDK' | 'Terraform';
}

export async function sharedConstructsGenerator(
  tree: Tree,
  options: SharedConstructsGeneratorOptions = {},
) {
  const { iacProvider = 'CDK' } = options;
  const npmScopePrefix = getNpmScopePrefix(tree);
  updateGitignore(tree);

  if (iacProvider === 'CDK') {
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
      tree.delete(
        joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'src'),
      );
      generateFiles(
        tree,
        joinPathFragments(__dirname, 'files', SHARED_CONSTRUCTS_DIR, 'src'),
        joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'src'),
        {
          npmScopePrefix,
          scopeAlias: toScopeAlias(npmScopePrefix),
          tags: (await readAwsNxPluginConfig(tree))?.tags ?? [],
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

  // Handle Terraform provider
  if (iacProvider === 'Terraform') {
    const terraformLibPath = joinPathFragments(
      PACKAGES_DIR,
      SHARED_TERRAFORM_DIR,
    );
    if (!tree.exists(joinPathFragments(terraformLibPath, 'project.json'))) {
      await terraformProjectGenerator(tree, {
        name: SHARED_TERRAFORM_NAME,
        directory: joinPathFragments(PACKAGES_DIR, 'common'),
        type: 'library',
      });

      tree.delete(joinPathFragments(terraformLibPath, 'src', 'main.tf'));

      // Create the metrics.tf file with empty initial values
      generateFiles(
        tree,
        joinPathFragments(__dirname, 'files', 'terraform'),
        terraformLibPath,
        {
          metricId: '',
          version: '',
          tags: '',
        },
        {
          overwriteStrategy: OverwriteStrategy.KeepExisting,
        },
      );

      await formatFilesInSubtree(tree);
    }
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
