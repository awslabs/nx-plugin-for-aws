/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { IacProvider } from '../utils/iac';

export interface PresetGeneratorSchema {
  readonly addTsPlugin?: boolean;
  readonly iacProvider: IacProvider;
}
