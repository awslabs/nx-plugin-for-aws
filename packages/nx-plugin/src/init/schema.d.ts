/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Containers } from '../utils/containers';
import { Iac } from '../utils/iac';

export type InitContainersOption = Containers | 'infer';

export interface InitGeneratorSchema {
  readonly iac: Iac;
  readonly mcp?: boolean;
  readonly containers?: InitContainersOption;
  readonly preferInstallDependencies?: boolean;
}
