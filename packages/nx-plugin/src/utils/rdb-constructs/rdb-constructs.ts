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
import { addStarExport } from '../ast';
import type { Containers } from '../containers';
import type { Iac } from '../iac';
import { esmVars } from '../module-format';
import { addDependencyToTargetIfNotPresent } from '../nx';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../shared-constructs-constants';
import { terraformProviderVersions } from '../versions';

export interface AddRdbConstructOptions {
  projectName: string;
  projectRoot: string;
  nameClassName: string;
  nameKebabCase: string;
  databasePackageAlias: string;
  databaseName: string;
  adminUser: string;
  engine: 'postgres' | 'mysql';
  migrationBundleDir: string;
  /**
   * Node.js zip bundle directory for the create-db-user Lambda (ts#rdb).
   * When absent the migration Docker image is reused with the
   * `create_db_user_handler.handler` command (py#rdb).
   */
  createDbUserBundleDir: string;
  /** ORM framework used by the create-db-user Lambda. */
  framework: 'prisma' | 'sqlmodel';
  /** Local Docker tag for the Python create-db-user Lambda image. */
  createDbUserDockerImageTag?: string;
  /** Local Docker tag for the migration Lambda image. */
  migrationDockerImageTag: string;
  containerEngine: Containers;
}

export const addRdbInfra = async (
  tree: Tree,
  options: AddRdbConstructOptions & { iac: Iac },
) => {
  if (options.iac === 'cdk') {
    await addRdbCdkConstructs(tree, options);
  } else if (options.iac === 'terraform') {
    addRdbTerraformModules(tree, options);
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
        `${options.projectName}:build`,
      );
      return config;
    },
  );
};

export const addRdbCdkConstructs = async (
  tree: Tree,
  options: AddRdbConstructOptions,
) => {
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'cdk', 'core', 'rdb'),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'core',
      'rdb',
    ),
    { ...options, ...esmVars(tree) },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'cdk', 'app', 'dbs'),
    joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'src', 'app', 'dbs'),
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
    joinPathFragments(import.meta.dirname, 'files', 'terraform', 'core', 'rdb'),
    joinPathFragments(PACKAGES_DIR, SHARED_TERRAFORM_DIR, 'src', 'core', 'rdb'),
    { ...terraformProviderVersions() },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'terraform', 'app', 'dbs'),
    joinPathFragments(PACKAGES_DIR, SHARED_TERRAFORM_DIR, 'src', 'app', 'dbs'),
    { ...options, ...terraformProviderVersions() },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );
};
