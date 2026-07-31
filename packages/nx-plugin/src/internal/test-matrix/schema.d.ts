/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export interface InternalTestMatrixGeneratorSchema {
  preferInstallDependencies?: boolean;
  /**
   * IaC provider of the workspace, so the matrix scaffolds the matching
   * infrastructure project. Defaults to `cdk`.
   */
  infra?: 'cdk' | 'terraform';
}
