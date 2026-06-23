/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { IacOption } from '../../utils/iac';

export type TsAgentFramework = 'strands' | 'langchain';
export type TsAgentInfra = 'agentcore' | 'none';
export type AgentProtocol = 'http' | 'a2a' | 'ag-ui';

export type TsAgentAuth = 'iam' | 'cognito';

export interface TsAgentGeneratorSchema {
  project: string;
  framework?: TsAgentFramework;
  name?: string;
  infra?: TsAgentInfra;
  auth?: TsAgentAuth;
  protocol?: AgentProtocol;
  iac: IacOption;
}
