/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * TypeScript types for options defined in schema.json
 */
export interface PyDynamoDBFastApiConnectionGeneratorSchema {
  sourceProject: string;
  targetProject: string;
  preferInstallDependencies?: boolean;
}
