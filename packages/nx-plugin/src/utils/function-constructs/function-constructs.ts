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

export interface AddLambdaFunctionConstructOptions {
  functionProjectName: string;
  nameClassName: string;
  nameKebabCase: string;
  bundlePathFromRoot: string;
  handler: string;
  runtime: 'node' | 'python';
}

/**
 * Add infrastructure for a lambda function
 */
export const addLambdaFunctionInfra = async (
  tree: Tree,
  options: AddLambdaFunctionConstructOptions & {
    iac: Iac;
  },
) => {
  if (options.iac === 'cdk') {
    await addLambdaFunctionCdkConstructs(tree, options);
  } else if (options.iac === 'terraform') {
    addLambdaFunctionTerraformModules(tree, options);
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
        `${options.functionProjectName}:build`,
      );
      return config;
    },
  );
};

const addLambdaFunctionCdkConstructs = async (
  tree: Tree,
  options: AddLambdaFunctionConstructOptions,
) => {
  // Generate app specific CDK construct
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'cdk', 'app', 'lambda-functions'),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'lambda-functions',
    ),
    {
      ...options,
      runtime: `Runtime.${options.runtime === 'python' ? 'PYTHON_3_14' : 'NODEJS_LATEST'}`,
    },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  // Export app specific CDK construct
  await addStarExport(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'lambda-functions',
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
    './lambda-functions/index.js',
  );
};

const addLambdaFunctionTerraformModules = (
  tree: Tree,
  options: AddLambdaFunctionConstructOptions,
) => {
  // Generate app specific terraform module
  generateFiles(
    tree,
    joinPathFragments(
      __dirname,
      'files',
      'terraform',
      'app',
      'lambda-functions',
    ),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_TERRAFORM_DIR,
      'src',
      'app',
      'lambda-functions',
    ),
    {
      ...options,
      runtime: options.runtime === 'python' ? 'python3.14' : 'nodejs22.x',
    },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );
};
