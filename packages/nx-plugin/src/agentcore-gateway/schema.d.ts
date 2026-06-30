/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IacOption } from '../utils/iac';

export interface AgentcoreGatewayGeneratorSchema {
  name: string;
  directory?: string;
  subDirectory?: string;
  protocol?: 'mcp';
  auth?: 'iam';
  cedarPolicy?: boolean;
  infra?: 'agentcore' | 'none';
  iac: IacOption;
  preferInstallDependencies?: boolean;
}
