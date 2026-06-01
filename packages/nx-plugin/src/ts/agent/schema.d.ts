/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { IacProviderOption } from '../../utils/iac';

export type TsAgentSdk = 'strands';
export type TsAgentComputeType = 'BedrockAgentCoreRuntime' | 'None';
export type AgentProtocol = 'HTTP' | 'A2A' | 'AG-UI';

export type TsAgentAuth = 'IAM' | 'Cognito';

export interface TsAgentGeneratorSchema {
  project: string;
  sdk?: TsAgentSdk;
  name?: string;
  computeType?: TsAgentComputeType;
  auth?: TsAgentAuth;
  protocol?: AgentProtocol;
  iacProvider: IacProviderOption;
}
