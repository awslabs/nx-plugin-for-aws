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
 * What a generator records about the infrastructure it generated.
 *
 * Every generator that creates infrastructure records the `iac` it used, so a
 * predicate can tell a CDK project from a Terraform one at upgrade time. Absent
 * when the generator was run with no infrastructure, in which case neither
 * provider's packages were added.
 */
export interface IacMetadata {
  readonly iac?: string;
}

/**
 * Dependencies a caller must declare to use the shared constructs project.
 * Lives here so generators can spread it without importing the generator.
 *
 * `constructs` and `aws-cdk-lib` are gated on CDK because
 * `sharedConstructsGenerator` creates the TypeScript constructs project on that
 * branch alone — a Terraform workspace gets the shared Terraform project and
 * never receives them.
 */
export const SHARED_CONSTRUCTS_DEPENDENCIES = [
  { name: 'constructs', when: (m: IacMetadata) => m.iac === 'cdk' },
  { name: 'aws-cdk-lib', when: (m: IacMetadata) => m.iac === 'cdk' },
  { name: '@types/node' },
] as const;
