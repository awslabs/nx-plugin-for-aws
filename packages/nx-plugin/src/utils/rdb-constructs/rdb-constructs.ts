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
import type { Containers } from '../containers.js';
import type { Iac } from '../iac.js';
import { esmVars } from '../module-format.js';
import { addArtifactProjectToTargets } from '../nx.js';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../shared-constructs-constants.js';
import {
  cdkLambdaRuntimeVars,
  terraformLambdaRuntimeVars,
  terraformProviderVersions,
} from '../versions.js';

/**
 * Aurora Serverless v2 scaling bounds, in ACUs, that both IaC providers derive
 * from so the same generator options vend the same ceiling regardless of `--iac`.
 *
 * Set explicitly on CDK rather than inheriting `DatabaseClusterProps`, whose
 * default moves with `aws-cdk-lib`. Serverless v2 bills on ACUs consumed, not on
 * the ceiling, so the maximum is headroom rather than a cost commitment.
 */
export const AURORA_SERVERLESS_V2_CAPACITY = {
  min: 0.5,
  max: 4,
} as const;

/**
 * Substitution variables exposing the Aurora Serverless v2 scaling bounds to
 * generated CDK and Terraform templates.
 */
const auroraServerlessV2Capacity = () => ({
  serverlessMinCapacity: AURORA_SERVERLESS_V2_CAPACITY.min,
  serverlessMaxCapacity: AURORA_SERVERLESS_V2_CAPACITY.max,
});

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
      addArtifactProjectToTargets(config, options.projectName);
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
    { ...options, ...esmVars(tree), ...auroraServerlessV2Capacity() },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'cdk', 'app', 'dbs'),
    joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'src', 'app', 'dbs'),
    { ...options, ...esmVars(tree), ...cdkLambdaRuntimeVars() },
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
    { ...terraformProviderVersions(), ...auroraServerlessV2Capacity() },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'terraform', 'app', 'dbs'),
    joinPathFragments(PACKAGES_DIR, SHARED_TERRAFORM_DIR, 'src', 'app', 'dbs'),
    {
      ...options,
      ...terraformProviderVersions(),
      ...auroraServerlessV2Capacity(),
      ...terraformLambdaRuntimeVars(),
    },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );
};
