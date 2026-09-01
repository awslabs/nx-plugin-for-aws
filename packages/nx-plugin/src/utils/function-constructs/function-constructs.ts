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
import type { Iac } from '../iac.js';
import { esmVars } from '../module-format.js';
import { addArtifactProjectToTargets } from '../nx.js';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../shared-constructs-constants.js';
import {
  cdkLambdaRuntime,
  terraformLambdaRuntime,
  terraformProviderVersions,
} from '../versions.js';

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
      addArtifactProjectToTargets(config, options.functionProjectName);
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
    joinPathFragments(
      import.meta.dirname,
      'files',
      'cdk',
      'app',
      'lambda-functions',
    ),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'lambda-functions',
    ),
    {
      ...options,
      runtime: cdkLambdaRuntime(options.runtime),
      ...esmVars(tree),
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
      import.meta.dirname,
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
      runtime: terraformLambdaRuntime(options.runtime),
      ...terraformProviderVersions(),
    },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );
};
