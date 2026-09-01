/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { AgentCoreInfra } from '../../utils/agent-core-packaging.js';
import { IacOption } from '../../utils/iac.js';

export type PyMcpServerInfra = AgentCoreInfra;

export type PyMcpServerAuth = 'iam' | 'cognito';

export interface PyMcpServerGeneratorSchema {
  project: string;
  name?: string;
  infra?: PyMcpServerInfra;
  auth?: PyMcpServerAuth;
  iac: IacOption;
  preferInstallDependencies?: boolean;
}
