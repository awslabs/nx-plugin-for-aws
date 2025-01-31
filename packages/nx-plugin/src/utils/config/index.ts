/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { LicenseConfig } from '../../license/config-types';
export * from '../../license/config-types';

/**
 * Configuration for the nx plugin
 */
export interface AwsNxPluginConfig {
  /**
   * Configuration for the license sync generator
   */
  license?: LicenseConfig;
}
