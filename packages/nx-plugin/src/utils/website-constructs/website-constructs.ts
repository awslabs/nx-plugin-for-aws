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
export const addWebsiteInfra = (
  tree: Tree,
  options: AddWebsiteInfraOptions & { iacProvider: 'CDK' | 'Terraform' },
) => {
  if (options.iacProvider === 'CDK') {
    addWebsiteCdkConstructs(tree, options);
  } else if (options.iacProvider === 'Terraform') {
    addWebsiteTerraformModules(tree, options);
  } else {
    throw new Error(`Unsupported iacProvider ${options.iacProvider}`);
  }

  updateJson(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      options.iacProvider === 'CDK'
        ? SHARED_CONSTRUCTS_DIR
        : SHARED_TERRAFORM_DIR,
      'project.json',
    ),
    (config: ProjectConfiguration) => {
      if (!config.targets) {
        config.targets = {};
      }
      if (!config.targets.build) {
        config.targets.build = {};
      }
      config.targets.build.dependsOn = [
        ...(config.targets.build.dependsOn ?? []),
        `${options.websiteProjectName}:build`,
      ];
      return config;
    },
  );
};

const addWebsiteCdkConstructs = (
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

  addStarExport(
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
  addStarExport(
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
  addStarExport(
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
