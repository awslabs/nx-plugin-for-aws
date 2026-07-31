/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { IacOption } from '../../utils/iac';

export type PyAgentFramework = 'strands' | 'langchain';
export type PyAgentInfra = 'agentcore' | 'none';
export type AgentProtocol = 'http' | 'a2a' | 'ag-ui';

export type PyAgentAuth = 'iam' | 'cognito';

export type PyAgentSession = 'none';

export interface PyAgentGeneratorSchema {
  project: string;
  framework?: PyAgentFramework;
  name?: string;
  infra?: PyAgentInfra;
  auth?: PyAgentAuth;
  protocol?: AgentProtocol;
  session?: PyAgentSession;
  iac: IacOption;
  preferInstallDependencies?: boolean;
}
