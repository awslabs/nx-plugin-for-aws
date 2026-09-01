/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IacOption } from '../utils/iac.js';

/**
 * Options for the agentcore-harness generator, mirroring schema.json.
 */
export interface AgentcoreHarnessGeneratorSchema {
  name: string;
  directory?: string;
  subDirectory?: string;
  infra?: 'agentcore' | 'none';
  iac?: IacOption;
  preferInstallDependencies?: boolean;
}
