/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { SupportedStyles } from '@nx/react';

export interface AppGeneratorSchema {
  name: string;
  directory?: string;
  skipInstall?: boolean;
}
