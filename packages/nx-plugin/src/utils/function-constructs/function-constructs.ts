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

export interface AddLambdaFunctionConstructOptions {
  functionProjectName: string;
  functionNameClassName: string;
  functionNameKebabCase: string;
  bundlePathFromRoot: string;
  handler: string;
  runtime: 'node' | 'python';
}

/**
 * Add infrastructure for a lambda function
 */
export const addLambdaFunctionInfra = (
  tree: Tree,
  options: AddLambdaFunctionConstructOptions & {
    iacProvider: 'CDK' | 'Terraform';
  },
) => {
  if (options.iacProvider === 'CDK') {
    addLambdaFunctionCdkConstructs(tree, options);
  } else if (options.iacProvider === 'Terraform') {
    addLambdaFunctionTerraformModules(tree, options);
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
        `${options.functionProjectName}:build`,
      ];
      return config;
    },
  );
};

const addLambdaFunctionCdkConstructs = (
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
      runtime: `Runtime.${options.runtime === 'python' ? 'PYTHON_3_12' : 'NODEJS_LATEST'}`,
    },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  // Export app specific CDK construct
  addStarExport(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'lambda-functions',
      'index.ts',
    ),
    `./${options.functionNameKebabCase}.js`,
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
      runtime: options.runtime === 'python' ? 'python3.12' : 'nodejs22.x',
    },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );
};
