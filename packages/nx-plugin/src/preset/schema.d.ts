/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Iac } from '../utils/iac';
import { Containers } from '../utils/containers';

export type PresetContainersOption = Containers | 'infer';

export interface PresetGeneratorSchema {
  readonly addTsPlugin?: boolean;
  readonly iac: Iac;
  readonly gitSecrets?: boolean;
  readonly mcp?: boolean;
  readonly containers?: PresetContainersOption;
}
