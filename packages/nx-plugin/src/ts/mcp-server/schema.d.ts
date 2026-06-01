/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { IacProviderOption } from '../../utils/iac';

export type TsMcpServerInfra = 'none' | 'agentcore';

export type TsMcpServerAuth = 'iam' | 'cognito';

export interface TsMcpServerGeneratorSchema {
  project: string;
  name?: string;
  infra?: TsMcpServerInfra;
  auth?: TsMcpServerAuth;
  iacProvider: IacProviderOption;
}
