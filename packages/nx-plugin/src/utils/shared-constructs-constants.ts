/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export const PACKAGES_DIR = 'packages';
export const SHARED_CONSTRUCTS_NAME = 'common-constructs';
export const SHARED_CONSTRUCTS_DIR = 'common/constructs';
export const SHARED_TERRAFORM_NAME = 'terraform';
export const SHARED_TERRAFORM_DIR = 'common/terraform';
export const SHARED_SHADCN_NAME = 'common-shadcn';
export const SHARED_SHADCN_DIR = 'common/shadcn';
export const SHARED_INFRA_CONFIG_NAME = 'common-infra-config';
export const SHARED_INFRA_CONFIG_DIR = 'common/infra-config';
export const SHARED_SCRIPTS_NAME = 'common-scripts';
export const SHARED_SCRIPTS_DIR = 'common/scripts';

export const DYNAMODB_GENERATOR_IDS = ['ts#dynamodb', 'py#dynamodb'];

/**
 * Dependencies a caller must declare to use the shared constructs project.
 * Lives here so generators can spread it without importing the generator.
 *
 * `constructs` and `aws-cdk-lib` only reach a workspace that uses CDK —
 * `sharedConstructsGenerator` creates the TypeScript project on that branch
 * alone. Ownership is narrowed by the workspace's `iac` in
 * `owned-dependencies.ts` rather than by a `when` here, since `iac` is a
 * workspace-wide choice and typing a predicate against it on this shared
 * constant would force it into all 19 generators' metadata interfaces.
 */
export const SHARED_CONSTRUCTS_DEPENDENCIES = [
  { name: 'constructs' },
  { name: 'aws-cdk-lib' },
  { name: '@types/node' },
] as const;

/** The shared constructs packages a Terraform workspace never receives. */
export const CDK_ONLY_DEPENDENCIES = ['constructs', 'aws-cdk-lib'] as const;
