/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export type TsMcpServerComputeType = 'None' | 'BedrockAgentCoreRuntime';

/**
 * TypeScript types for options defined in schema.json
 * Update this to match schema.json if you make changes.
 */
export interface TsMcpServerGeneratorSchema {
  project: string;
  name?: string;
  computeType?: TsMcpServerComputeType;
}
