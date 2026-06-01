/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { IacProviderOption } from '../../utils/iac';

export type PyAgentSdk = 'strands';
export type PyAgentInfra = 'agentcore' | 'none';
export type AgentProtocol = 'HTTP' | 'A2A' | 'AG-UI';

export type PyAgentAuth = 'iam' | 'cognito';

export interface PyAgentGeneratorSchema {
  project: string;
  sdk?: PyAgentSdk;
  name?: string;
  infra?: PyAgentInfra;
  auth?: PyAgentAuth;
  protocol?: AgentProtocol;
  iacProvider: IacProviderOption;
}
