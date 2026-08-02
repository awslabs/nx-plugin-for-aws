/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IacOption } from '../utils/iac';

/**
 * Raw options for the agentcore-harness generator, mirroring schema.json
 * exactly (same option names, value types, optionality and enum values).
 *
 * Omitted optional values intentionally remain `undefined` (schema.json
 * declares no JSON Schema `default` for them) so the generator-side resolver
 * can distinguish omission from an explicitly supplied value on reruns.
 * Exact defaults are applied by `resolveAgentcoreHarnessOptions`.
 */
export interface AgentcoreHarnessGeneratorSchema {
  name: string;
  directory?: string;
  subDirectory?: string;
  infra?: 'agentcore' | 'none';
  iac?: IacOption;
  preferInstallDependencies?: boolean;
}
