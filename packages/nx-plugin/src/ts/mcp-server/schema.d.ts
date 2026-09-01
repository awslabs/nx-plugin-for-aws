/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { AgentCoreInfra } from '../../utils/agent-core-packaging.js';
import { IacOption } from '../../utils/iac.js';

export type TsMcpServerInfra = AgentCoreInfra;

export type TsMcpServerAuth = 'iam' | 'cognito';

export interface TsMcpServerGeneratorSchema {
  project: string;
  name?: string;
  infra?: TsMcpServerInfra;
  auth?: TsMcpServerAuth;
  iac: IacOption;
  preferInstallDependencies?: boolean;
}
