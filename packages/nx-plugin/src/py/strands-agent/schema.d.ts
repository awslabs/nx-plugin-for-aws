/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export type PyStrandsAgentComputeType = 'BedrockAgentCoreRuntime' | 'None';

export interface PyStrandsAgentGeneratorSchema {
  project: string;
  name?: string;
  computeType?: PyStrandsAgentComputeType;
  iacProvider: 'CDK' | 'Terraform';
}
