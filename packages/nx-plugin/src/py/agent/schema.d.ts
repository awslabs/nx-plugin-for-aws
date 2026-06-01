/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { IacOption } from '../../utils/iac';

export type PyAgentFramework = 'strands';
export type PyAgentInfra = 'agentcore' | 'none';
export type AgentProtocol = 'http' | 'a2a' | 'ag-ui';

export type PyAgentAuth = 'iam' | 'cognito';

export interface PyAgentGeneratorSchema {
  project: string;
  framework?: PyAgentFramework;
  name?: string;
  infra?: PyAgentInfra;
  auth?: PyAgentAuth;
  protocol?: AgentProtocol;
  iac: IacOption;
}
