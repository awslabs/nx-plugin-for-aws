/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { AgentCoreInfra } from '../../utils/agent-core-packaging.js';
import { IacOption } from '../../utils/iac.js';

export type TsAgentFramework = 'strands';
export type TsAgentInfra = AgentCoreInfra;
export type AgentProtocol = 'http' | 'a2a' | 'ag-ui';

export type TsAgentAuth = 'iam' | 'cognito';

export type TsAgentSession = 's3' | 'in-memory';

export interface TsAgentGeneratorSchema {
  project: string;
  framework?: TsAgentFramework;
  name?: string;
  infra?: TsAgentInfra;
  auth?: TsAgentAuth;
  protocol?: AgentProtocol;
  session?: TsAgentSession;
  iac: IacOption;
  preferInstallDependencies?: boolean;
}
