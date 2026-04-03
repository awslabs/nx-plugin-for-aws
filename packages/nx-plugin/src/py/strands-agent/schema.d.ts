/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { IacProviderOption } from '../../utils/iac';

export type PyStrandsAgentComputeType = 'BedrockAgentCoreRuntime' | 'None';

export type PyStrandsAgentAuth = 'IAM' | 'Cognito';

export interface PyStrandsAgentGeneratorSchema {
  project: string;
  name?: string;
  computeType?: PyStrandsAgentComputeType;
  auth?: PyStrandsAgentAuth;
  iacProvider: IacProviderOption;
}
