/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { LicenseConfig } from '../../license/config-types';
import { IacConfig } from '../iac';
import { UxConfig } from '../ux';

export * from '../../license/config-types';
export { IacConfig, IacProvider } from '../iac';
export { UxConfig } from '../ux';

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
   * Configuration for ux
   */
  ux?: UxConfig;

  /**
   * List of tags
   */
  tags?: string[];
}
