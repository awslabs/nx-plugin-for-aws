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
import { addDependenciesToPackageJson } from '../dependencies';
import type { Iac } from '../iac';
import { esmVars } from '../module-format';
import { addDependencyToTargetIfNotPresent } from '../nx';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../shared-constructs-constants';
import {
  type ITsDepVersion,
  PY_VERSIONS,
  terraformProviderVersions,
  withVersions,
} from '../versions';

interface BackendOptions {
  type: 'trpc' | 'fastapi' | 'smithy';
  integrationPattern: 'isolated' | 'shared';
}

export interface TrpcBackendOptions extends BackendOptions {
  type: 'trpc';
  projectAlias: string;
  bundleOutputDir: string;
  authorizerBundleOutputDir?: string;
}

export interface FastApiBackendOptions extends BackendOptions {
  type: 'fastapi';
  moduleName: string;
  bundleOutputDir: string;
}

export interface SmithyBackendOptions extends BackendOptions {
  type: 'smithy';
  bundleOutputDir: string;
  authorizerBundleOutputDir?: string;
}

export interface AddApiGatewayConstructOptions {
  apiProjectName: string;
  apiNameClassName: string;
  apiNameKebabCase: string;
  constructType: 'http' | 'rest';
  backend: TrpcBackendOptions | FastApiBackendOptions | SmithyBackendOptions;
  auth: 'iam' | 'cognito' | 'custom';
}

export const addApiGatewayInfra = async (
  tree: Tree,
  options: AddApiGatewayConstructOptions & { iac: Iac },
) => {
  if (options.iac === 'cdk') {
    await addApiGatewayCdkConstructs(tree, options);
  } else if (options.iac === 'terraform') {
    addApiGatewayTerraformModules(tree, options);
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
        `${options.apiProjectName}:build`,
      );
      return config;
    },
  );
};

/**
 * Add an API CDK construct, and update the Runtime Config type to export its url
 */
const addApiGatewayCdkConstructs = async (
  tree: Tree,
  options: AddApiGatewayConstructOptions,
) => {
  const generateCoreApiFile = (name: string) => {
    generateFiles(
      tree,
      joinPathFragments(
        import.meta.dirname,
        'files',
        'cdk',
        'core',
        'api',
        name,
      ),
      joinPathFragments(
        PACKAGES_DIR,
        SHARED_CONSTRUCTS_DIR,
        'src',
        'core',
        'api',
      ),
      { ...esmVars(tree) },
      {
        overwriteStrategy: OverwriteStrategy.KeepExisting,
      },
    );
  };

  // Generate relevant core CDK construct and utilities
  generateCoreApiFile(options.constructType);
  generateCoreApiFile('utils');
  if (options.backend.type === 'trpc') {
    generateCoreApiFile('trpc');
  }

  // Declare the third-party dependencies the generated core construct files
  // import, in the shared constructs project's own package.json.
  const constructDeps: ITsDepVersion[] = [];
  if (options.constructType === 'rest') {
    // The REST API Gateway account construct configures the account via the
    // AWS SDK.
    constructDeps.push('@aws-sdk/client-api-gateway', '@aws-sdk/client-iam');
  }
  if (options.backend.type === 'trpc') {
    // trpc-utils.ts types the router with @trpc/server.
    constructDeps.push('@trpc/server');
  }
  if (constructDeps.length > 0) {
    addDependenciesToPackageJson(
      tree,
      withVersions(constructDeps),
      {},
      joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'package.json'),
    );
  }

  // Generate app specific CDK construct
  generateFiles(
    tree,
    joinPathFragments(
      import.meta.dirname,
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
    { ...options, ...esmVars(tree) },
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
      import.meta.dirname,
      'files',
      'terraform',
      'core',
      'api',
      options.constructType,
    ),
    joinPathFragments(PACKAGES_DIR, SHARED_TERRAFORM_DIR, 'src', 'core', 'api'),
    { boto3Version: PY_VERSIONS.boto3, ...terraformProviderVersions() },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  // Generate app specific terraform module
  generateFiles(
    tree,
    joinPathFragments(
      import.meta.dirname,
      'files',
      'terraform',
      'app',
      'apis',
      options.constructType,
    ),
    joinPathFragments(PACKAGES_DIR, SHARED_TERRAFORM_DIR, 'src', 'app', 'apis'),
    { ...options, ...terraformProviderVersions() },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );
};
