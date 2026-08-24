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
import { addStarExport } from '../ast.js';
import type { DeclaredPyDependency } from '../declared-dependencies.js';
import type { Iac } from '../iac.js';
import { esmVars } from '../module-format.js';
import { addDependencyToTargetIfNotPresent } from '../nx.js';
import {
  generatedTerraform,
  type IacMetadata,
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../shared-constructs-constants.js';
import {
  type IPyDepVersion,
  PY_VERSIONS,
  terraformProviderVersions,
} from '../versions.js';

/**
 * Python version the generated Terraform pins in the static website module's
 * inline `uv run --with` scripts, which upload the site's assets. Nothing
 * installs it, so it is declared for its version alone, and only on the
 * Terraform branch that writes the scripts.
 */
export const WEBSITE_CONSTRUCTS_PY_DEPENDENCIES = [
  { name: 'boto3', when: generatedTerraform },
] as const satisfies readonly DeclaredPyDependency<
  IPyDepVersion,
  IacMetadata
>[];

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
    joinPathFragments(import.meta.dirname, 'files', 'cdk', 'core'),
    joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'src', 'core'),
    { ...options, ...esmVars(tree) },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'cdk', 'app'),
    joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'src', 'app'),
    { ...options, ...esmVars(tree) },
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
    joinPathFragments(import.meta.dirname, 'files', 'terraform', 'core'),
    joinPathFragments(PACKAGES_DIR, SHARED_TERRAFORM_DIR, 'src', 'core'),
    {
      ...options,
      boto3Version: PY_VERSIONS.boto3,
      ...terraformProviderVersions(),
    },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'terraform', 'app'),
    joinPathFragments(PACKAGES_DIR, SHARED_TERRAFORM_DIR, 'src', 'app'),
    { ...options, ...terraformProviderVersions() },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );
};
