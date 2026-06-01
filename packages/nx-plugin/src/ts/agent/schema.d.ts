/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { IacOption } from '../../utils/iac';

export type TsAgentSdk = 'strands';
export type TsAgentInfra = 'agentcore' | 'none';
export type AgentProtocol = 'HTTP' | 'A2A' | 'AG-UI';

export type TsAgentAuth = 'iam' | 'cognito';

export interface TsAgentGeneratorSchema {
  project: string;
  sdk?: TsAgentSdk;
  name?: string;
  infra?: TsAgentInfra;
  auth?: TsAgentAuth;
  protocol?: AgentProtocol;
  iac: IacOption;
}
