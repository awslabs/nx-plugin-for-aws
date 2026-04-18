/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { IacProviderOption } from '../../utils/iac';

export type TsStrandsAgentComputeType = 'BedrockAgentCoreRuntime' | 'None';
export type StrandsAgentProtocol = 'HTTP' | 'A2A' | 'AG-UI';

export type TsStrandsAgentAuth = 'IAM' | 'Cognito';

export interface TsStrandsAgentGeneratorSchema {
  project: string;
  name?: string;
  computeType?: TsStrandsAgentComputeType;
  auth?: TsStrandsAgentAuth;
  protocol?: StrandsAgentProtocol;
  iacProvider: IacProviderOption;
}
