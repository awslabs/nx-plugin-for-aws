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
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../shared-constructs-constants';
import { addStarExport } from '../ast';
import { IacProvider } from '../iac';

export interface AddRdbConstructOptions {
  nameClassName: string;
  nameKebabCase: string;
  databasePackageAlias: string;
  databaseName: string;
  adminUser: string;
  engine: 'postgres' | 'mysql';
  migrationBundleDir: string;
  createDbUserBundleDir: string;
}

export const addRdbInfra = async (
  tree: Tree,
  options: AddRdbConstructOptions & { iacProvider: IacProvider },
) => {
  if (options.iacProvider === 'CDK') {
    await addRdbCdkConstructs(tree, options);
  } else if (options.iacProvider === 'Terraform') {
    addRdbTerraformModules(tree, options);
  } else {
    throw new Error(`Unsupported iacProvider ${options.iacProvider}`);
  }
};

export const addRdbCdkConstructs = async (
  tree: Tree,
  options: AddRdbConstructOptions,
) => {
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'cdk', 'core', 'rdb'),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'core',
      'rdb',
    ),
    options,
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'cdk', 'app', 'dbs'),
    joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'src', 'app', 'dbs'),
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
      'core',
      'index.ts',
    ),
    './rdb/aurora.js',
  );
  await addStarExport(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'dbs',
      'index.ts',
    ),
    `./${options.nameKebabCase}.js`,
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
    './dbs/index.js',
  );
};

export const addRdbTerraformModules = (
  tree: Tree,
  options: AddRdbConstructOptions,
) => {
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'terraform', 'core', 'rdb'),
    joinPathFragments(PACKAGES_DIR, SHARED_TERRAFORM_DIR, 'src', 'core', 'rdb'),
    {},
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'terraform', 'app', 'dbs'),
    joinPathFragments(PACKAGES_DIR, SHARED_TERRAFORM_DIR, 'src', 'app', 'dbs'),
    options,
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );
};
