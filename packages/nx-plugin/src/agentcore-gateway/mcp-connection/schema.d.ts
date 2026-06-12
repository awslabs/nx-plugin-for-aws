/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ComponentMetadata } from '../../utils/nx';

export interface AgentcoreGatewayMcpConnectionGeneratorSchema {
  sourceProject: string;
  targetProject: string;
  sourceComponent?: ComponentMetadata;
  targetComponent?: ComponentMetadata;
}
