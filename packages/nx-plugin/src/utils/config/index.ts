/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LicenseConfig } from '../../license/config-types';
import type { ContainersConfig } from '../containers';
import type { IacConfig } from '../iac';

export * from '../../license/config-types';
export { Containers, ContainersConfig } from '../containers';
export { Iac, IacConfig } from '../iac';

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
   * Configuration for container tooling (build/push/login)
   */
  containers?: ContainersConfig;

  /**
   * List of tags
   */
  tags?: string[];
}
