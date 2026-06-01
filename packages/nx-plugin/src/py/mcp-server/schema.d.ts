/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { IacOption } from '../../utils/iac';

export type PyMcpServerInfra = 'none' | 'agentcore';

export type PyMcpServerAuth = 'iam' | 'cognito';

export interface PyMcpServerGeneratorSchema {
  project: string;
  name?: string;
  infra?: PyMcpServerInfra;
  auth?: PyMcpServerAuth;
  iac: IacOption;
}
