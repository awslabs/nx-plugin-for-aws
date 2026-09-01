/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Containers } from '../utils/containers.js';
import { Iac } from '../utils/iac.js';
import type { ModuleFormat } from '../utils/module-format.js';

export type PresetContainersOption = Containers | 'infer';

export interface PresetGeneratorSchema {
  readonly iac: Iac;
  readonly gitSecrets?: boolean;
  readonly mcp?: boolean;
  readonly containers?: PresetContainersOption;
  readonly module?: ModuleFormat;
  readonly catalog?: boolean;
  readonly preferInstallDependencies?: boolean;
}
