/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import {
  AWS_NX_PLUGIN_CONFIG_FILE_NAME,
  readAwsNxPluginConfig,
} from './config/utils';

export const IAC_PROVIDERS = ['CDK', 'Terraform'] as const;

export type IacProvider = (typeof IAC_PROVIDERS)[number];

export type IacProviderOption = IacProvider | 'Inherit';

/**
 * Configuration for infrastructure as code
 */
export interface IacConfig {
  /**
   * Default provider for infrastructure as code
   */
  provider: IacProvider;
}

/**
 * Given an iac provider option, resolve the actual iac provider to use
 */
export const resolveIacProvider = async (
  tree: Tree,
  iacProviderOption: IacProviderOption,
): Promise<IacProvider> => {
  if (iacProviderOption === 'Inherit') {
    const pluginConfig = await readAwsNxPluginConfig(tree);

    if (!pluginConfig?.iac?.provider) {
      throw new Error(
        `IaC provider "Inherit" requires iac.provider to be set in ${AWS_NX_PLUGIN_CONFIG_FILE_NAME}`,
      );
    }
    if (!IAC_PROVIDERS.includes(pluginConfig.iac.provider)) {
      throw new Error(
        `iac.provider in ${AWS_NX_PLUGIN_CONFIG_FILE_NAME} must be one of ${IAC_PROVIDERS.join(', ')}`,
      );
    }

    return pluginConfig.iac.provider;
  }
  return iacProviderOption;
};
