/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { LicenseConfig } from '../../license/config-types';
import { IacConfig } from '../iac';

export * from '../../license/config-types';
export { IacConfig, IacProvider } from '../iac';

/**
 * Configuration for the nx plugin
 */
export interface AwsNxPluginConfig {
  /**
   * Configuration for the license sync generator
   */
  license?: LicenseConfig;

  /**
   * Configuration for infrastructure as code
   */
  iac?: IacConfig;

  /**
   * List of tags
   */
  tags?: string[];
}
