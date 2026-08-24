/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type ProjectConfiguration,
  type Tree,
  updateJson,
} from '@nx/devkit';
import terraformProjectGenerator from '../terraform/project/generator.js';
import tsProjectGenerator from '../ts/lib/generator.js';
import { readAwsNxPluginConfig } from './config/utils.js';
import type {
  DependencyDeclaration,
  MustDeclare,
} from './declared-dependencies.js';
import { addDependenciesToPackageJson } from './dependencies.js';
import { formatFilesInSubtree } from './format.js';
import type { Iac } from './iac.js';
import { esmVars } from './module-format.js';
import { getNpmScopePrefix } from './npm-scope.js';
import { getPackageManagerDisplayCommands } from './pkg-manager.js';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DEPENDENCIES,
  SHARED_CONSTRUCTS_DIR,
  SHARED_CONSTRUCTS_NAME,
  SHARED_TERRAFORM_DIR,
  SHARED_TERRAFORM_NAME,
} from './shared-constructs-constants.js';

export { SHARED_CONSTRUCTS_DEPENDENCIES };

import { terraformProviderVersions, withVersions } from './versions.js';

export interface SharedConstructsGeneratorOptions {
  iac: Iac;
}

export async function sharedConstructsGenerator<
  const D extends DependencyDeclaration,
>(
  tree: Tree,
  options: SharedConstructsGeneratorOptions,
  declaration: D & MustDeclare<typeof SHARED_CONSTRUCTS_DEPENDENCIES, D>,
) {
  const { iac } = options;
  const npmScopePrefix = getNpmScopePrefix(tree);
  updateGitignore(tree);

  if (iac === 'cdk') {
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
        joinPathFragments(
          import.meta.dirname,
          'files',
          SHARED_CONSTRUCTS_DIR,
          'src',
        ),
        joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'src'),
        {
          npmScopePrefix,
          scopeAlias: npmScopePrefix,
          tags: readAwsNxPluginConfig(tree)?.tags ?? [],
          ...esmVars(tree),
        },
        {
          overwriteStrategy: OverwriteStrategy.KeepExisting,
        },
      );
      generateFiles(
        tree,
        joinPathFragments(import.meta.dirname, 'files', 'common', 'readme'),
        joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR),
        {
          fullyQualifiedName: `${npmScopePrefix}${SHARED_CONSTRUCTS_NAME}`,
          name: SHARED_CONSTRUCTS_NAME,
          pkgMgrCmd: getPackageManagerDisplayCommands().exec,
        },
        {
          overwriteStrategy: OverwriteStrategy.Overwrite,
        },
      );
      addDependenciesToPackageJson(
        tree,
        withVersions(
          declaration as DependencyDeclaration<
            typeof SHARED_CONSTRUCTS_DEPENDENCIES
          >,
          ['constructs', 'aws-cdk-lib'],
        ),
        withVersions(
          declaration as DependencyDeclaration<
            typeof SHARED_CONSTRUCTS_DEPENDENCIES
          >,
          ['@types/node'],
        ),
        joinPathFragments(
          joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR),
          'package.json',
        ),
      );
      await formatFilesInSubtree(tree);
    }
  }

  // Handle Terraform provider
  if (iac === 'terraform') {
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

      // `build` is a no-op orchestration target that produces no files of its
      // own. Terraform writes runtime-config entries into
      // `dist/{projectRoot}/runtime-config` at apply time, and other terraform
      // projects contribute their own entries to the same directory. Without
      // explicit outputs, Nx infers `dist/{projectRoot}` as this target's
      // cached output and, on a cache hit, restores the cached copy over the
      // freshly-applied config — wiping the very values consumers read. Declare
      // no outputs so Nx never treats runtime config as a cacheable artifact.
      updateJson(
        tree,
        joinPathFragments(PACKAGES_DIR, SHARED_TERRAFORM_DIR, 'project.json'),
        (projectConfig: ProjectConfiguration) => {
          projectConfig.targets ??= {};
          projectConfig.targets.build ??= {};
          projectConfig.targets.build.outputs = [];
          return projectConfig;
        },
      );

      tree.delete(joinPathFragments(terraformLibPath, 'src', 'main.tf'));

      // Create the metrics.tf file with empty initial values
      generateFiles(
        tree,
        joinPathFragments(import.meta.dirname, 'files', 'terraform'),
        terraformLibPath,
        { ...terraformProviderVersions() },
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
