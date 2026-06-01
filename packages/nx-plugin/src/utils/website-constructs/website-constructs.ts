/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  ProjectConfiguration,
  Tree,
  updateJson,
} from '@nx/devkit';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../shared-constructs-constants';
import { addStarExport } from '../ast';
import { Iac } from '../iac';
import { addDependencyToTargetIfNotPresent } from '../nx';

export interface AddWebsiteInfraOptions {
  websiteProjectName: string;
  scopeAlias: string;
  websiteContentPath: string;
  websiteNameKebabCase: string;
  websiteNameClassName: string;
}

/**
 * Add infrastructure for a static website
 */
export const addWebsiteInfra = async (
  tree: Tree,
  options: AddWebsiteInfraOptions & { iac: Iac },
) => {
  if (options.iac === 'cdk') {
    await addWebsiteCdkConstructs(tree, options);
  } else if (options.iac === 'terraform') {
    addWebsiteTerraformModules(tree, options);
  } else {
    throw new Error(`Unsupported iac ${options.iac}`);
  }

  updateJson(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      options.iac === 'cdk' ? SHARED_CONSTRUCTS_DIR : SHARED_TERRAFORM_DIR,
      'project.json',
    ),
    (config: ProjectConfiguration) => {
      addDependencyToTargetIfNotPresent(
        config,
        'build',
        `${options.websiteProjectName}:build`,
      );
      return config;
    },
  );
};

const addWebsiteCdkConstructs = async (
  tree: Tree,
  options: AddWebsiteInfraOptions,
) => {
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'cdk', 'core'),
    joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'src', 'core'),
    options,
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'cdk', 'app'),
    joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'src', 'app'),
    options,
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  await addStarExport(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'index.ts',
    ),
    './static-websites/index.js',
  );
  await addStarExport(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'static-websites',
      'index.ts',
    ),
    `./${options.websiteNameKebabCase}.js`,
  );
  await addStarExport(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'core',
      'index.ts',
    ),
    './static-website.js',
  );
};

const addWebsiteTerraformModules = (
  tree: Tree,
  options: AddWebsiteInfraOptions,
) => {
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'terraform', 'core'),
    joinPathFragments(PACKAGES_DIR, SHARED_TERRAFORM_DIR, 'src', 'core'),
    options,
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'terraform', 'app'),
    joinPathFragments(PACKAGES_DIR, SHARED_TERRAFORM_DIR, 'src', 'app'),
    options,
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );
};
