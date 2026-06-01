/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { LicenseConfig } from '../../license/config-types';
import { IacConfig } from '../iac';
import { ContainersConfig } from '../containers';

export * from '../../license/config-types';
export { IacConfig, IacProvider } from '../iac';
export { ContainersConfig, ContainerEngine } from '../containers';

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
