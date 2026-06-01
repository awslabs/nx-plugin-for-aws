/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { IacProviderOption } from '../../utils/iac';

export type PyAgentSdk = 'strands';
export type PyAgentComputeType = 'BedrockAgentCoreRuntime' | 'None';
export type AgentProtocol = 'HTTP' | 'A2A' | 'AG-UI';

export type PyAgentAuth = 'IAM' | 'Cognito';

export interface PyAgentGeneratorSchema {
  project: string;
  sdk?: PyAgentSdk;
  name?: string;
  computeType?: PyAgentComputeType;
  auth?: PyAgentAuth;
  protocol?: AgentProtocol;
  iacProvider: IacProviderOption;
}
