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
import { IacProvider } from '../iac';

interface BackendOptions {
  type: 'trpc' | 'fastapi' | 'smithy';
  integrationPattern: 'isolated' | 'shared';
}

export interface TrpcBackendOptions extends BackendOptions {
  type: 'trpc';
  projectAlias: string;
  bundleOutputDir: string;
}

export interface FastApiBackendOptions extends BackendOptions {
  type: 'fastapi';
  moduleName: string;
  bundleOutputDir: string;
}

export interface SmithyBackendOptions extends BackendOptions {
  type: 'smithy';
  bundleOutputDir: string;
}

export interface AddApiGatewayConstructOptions {
  apiProjectName: string;
  apiNameClassName: string;
  apiNameKebabCase: string;
  constructType: 'http' | 'rest';
  backend: TrpcBackendOptions | FastApiBackendOptions | SmithyBackendOptions;
  auth: 'IAM' | 'Cognito' | 'None';
}

export const addApiGatewayInfra = async (
  tree: Tree,
  options: AddApiGatewayConstructOptions & { iacProvider: IacProvider },
) => {
  if (options.iacProvider === 'CDK') {
    await addApiGatewayCdkConstructs(tree, options);
  } else if (options.iacProvider === 'Terraform') {
    addApiGatewayTerraformModules(tree, options);
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
        `${options.apiProjectName}:build`,
      ];
      return config;
    },
  );
};

/**
 * Generate core API CDK files (utils, trpc, http, rest) into the shared constructs directory.
 * Shared between API Gateway and ECS constructs.
 */
export const generateCoreApiCdkFiles = (tree: Tree, names: string[]) => {
  for (const name of names) {
    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files', 'cdk', 'core', 'api', name),
      joinPathFragments(
        PACKAGES_DIR,
        SHARED_CONSTRUCTS_DIR,
        'src',
        'core',
        'api',
      ),
      {},
      {
        overwriteStrategy: OverwriteStrategy.KeepExisting,
      },
    );
  }
};

/**
 * Add an API CDK construct, and update the Runtime Config type to export its url
 */
const addApiGatewayCdkConstructs = async (
  tree: Tree,
  options: AddApiGatewayConstructOptions,
) => {
  // Generate relevant core CDK construct and utilities
  generateCoreApiCdkFiles(tree, [
    options.constructType,
    'utils',
    ...(options.backend.type === 'trpc' ? ['trpc'] : []),
  ]);

  // Generate app specific CDK construct
  generateFiles(
    tree,
    joinPathFragments(
      __dirname,
      'files',
      'cdk',
      'app',
      'apis',
      options.constructType,
    ),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'apis',
    ),
    options,
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
      'apis',
      'index.ts',
    ),
    `./${options.apiNameKebabCase}.js`,
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
    './apis/index.js',
  );
};

/**
 * Add an API terraform module, and update the Runtime Config type to export its url
 */
const addApiGatewayTerraformModules = (
  tree: Tree,
  options: AddApiGatewayConstructOptions,
) => {
  // Generate core terraform module
  generateFiles(
    tree,
    joinPathFragments(
      __dirname,
      'files',
      'terraform',
      'core',
      'api',
      options.constructType,
    ),
    joinPathFragments(PACKAGES_DIR, SHARED_TERRAFORM_DIR, 'src', 'core', 'api'),
    {},
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  // Generate app specific terraform module
  generateFiles(
    tree,
    joinPathFragments(
      __dirname,
      'files',
      'terraform',
      'app',
      'apis',
      options.constructType,
    ),
    joinPathFragments(PACKAGES_DIR, SHARED_TERRAFORM_DIR, 'src', 'app', 'apis'),
    options,
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );
};
