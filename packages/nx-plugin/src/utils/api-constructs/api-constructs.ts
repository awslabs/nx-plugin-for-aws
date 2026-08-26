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
import {
  type DeclaredPyDependency,
  type DeclaredTsDependency,
  type DependencyDeclaration,
  forDependencies,
  type MustDeclare,
} from '../declared-dependencies.js';
import { addDependenciesToPackageJson } from '../dependencies.js';
import type { Iac } from '../iac.js';
import { esmVars } from '../module-format.js';
import { addDependencyToTargetIfNotPresent } from '../nx.js';
import {
  generatedInfrastructure,
  generatedTerraform,
  type IacMetadata,
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../shared-constructs-constants.js';
import {
  type IPyDepVersion,
  type ITsDepVersion,
  PY_VERSIONS,
  terraformProviderVersions,
  withVersions,
} from '../versions.js';

/**
 * Dependencies a caller must declare to add API Gateway infrastructure.
 *
 * Gated on infrastructure having been generated: `addApiGatewayInfra` only runs
 * on that branch, so a project generated with `infra: 'none'` never receives
 * these.
 */
export const API_CONSTRUCTS_DEPENDENCIES = [
  { name: '@aws-sdk/client-api-gateway', when: generatedInfrastructure },
  { name: '@aws-sdk/client-iam', when: generatedInfrastructure },
  { name: '@trpc/server', when: generatedInfrastructure },
] as const satisfies readonly DeclaredTsDependency<
  ITsDepVersion,
  IacMetadata
>[];

/**
 * Python version the generated Terraform pins in the account module's inline
 * `uv run --with` script. Nothing installs it, so it is declared for its version
 * alone, and only on the Terraform branch that writes the script.
 */
export const API_CONSTRUCTS_PY_DEPENDENCIES = [
  { name: 'boto3', when: generatedTerraform },
] as const satisfies readonly DeclaredPyDependency<
  IPyDepVersion,
  IacMetadata
>[];

/**
 * Path segments a REST API operation may have in the generated Terraform.
 *
 * API Gateway REST APIs need a resource per path segment, and Terraform cannot
 * express recursion, so the module declares one resource per level up to this
 * depth. Deeper paths fail the plan with a message pointing at the fix.
 */
const MAX_REST_PATH_DEPTH = 8;

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

export const addApiGatewayInfra = async <const D extends DependencyDeclaration>(
  tree: Tree,
  options: AddApiGatewayConstructOptions & { iac: Iac },
  declaration: D & MustDeclare<typeof API_CONSTRUCTS_DEPENDENCIES, D>,
) => {
  if (options.iac === 'cdk') {
    await addApiGatewayCdkConstructs(tree, options, declaration);
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
  declaration: DependencyDeclaration,
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

  // Declare the deps the generated core construct files import.
  const constructDeps: (typeof API_CONSTRUCTS_DEPENDENCIES)[number]['name'][] =
    [];
  if (options.constructType === 'rest') {
    // REST account construct configures the account via the AWS SDK.
    constructDeps.push('@aws-sdk/client-api-gateway', '@aws-sdk/client-iam');
  }
  if (options.backend.type === 'trpc') {
    // trpc-utils.ts types the router with @trpc/server.
    constructDeps.push('@trpc/server');
  }
  if (constructDeps.length > 0) {
    addDependenciesToPackageJson(
      tree,
      withVersions(
        forDependencies<typeof API_CONSTRUCTS_DEPENDENCIES>(declaration),
        constructDeps,
      ),
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
    {
      ...options,
      maxRestPathDepth: MAX_REST_PATH_DEPTH,
      ...terraformProviderVersions(),
    },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );
};
