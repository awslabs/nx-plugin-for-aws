/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { AgentCoreInfra } from '../../utils/agent-core-packaging.js';
import { IacOption } from '../../utils/iac.js';

export type PyAgentFramework = 'strands' | 'langchain';
export type PyAgentInfra = AgentCoreInfra;
export type AgentProtocol = 'http' | 'a2a' | 'ag-ui';

export type PyAgentAuth = 'iam' | 'cognito';

export type PyAgentSession = 's3' | 'dynamodb-s3' | 'in-memory';

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
