/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { IacProvider } from '../utils/iac';
import { ContainerEngine } from '../utils/containers';

export type PresetContainerEngineOption = ContainerEngine | 'infer';

export interface PresetGeneratorSchema {
  readonly addTsPlugin?: boolean;
  readonly iacProvider: IacProvider;
  readonly gitSecrets?: boolean;
  readonly containerEngine?: PresetContainerEngineOption;
}
