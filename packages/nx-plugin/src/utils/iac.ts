/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import {
  AWS_NX_PLUGIN_CONFIG_FILE_NAME,
  readAwsNxPluginConfig,
} from './config/utils';

export { IAC_PROVIDERS, type Iac, type IacOption } from './iac-providers';

import { IAC_PROVIDERS } from './iac-providers';

/**
 * Configuration for infrastructure as code
 */
export interface IacConfig {
  /**
   * Default provider for infrastructure as code
   */
  provider: (typeof IAC_PROVIDERS)[number];
}

/**
 * Given an iac provider option, resolve the actual iac provider to use
 */
export const resolveIac = async (
  tree: Tree,
  iacOption: 'cdk' | 'terraform' | 'inherit',
): Promise<(typeof IAC_PROVIDERS)[number]> => {
  if (iacOption === 'inherit') {
    const pluginConfig = readAwsNxPluginConfig(tree);

    if (!pluginConfig?.iac?.provider) {
      throw new Error(
        `IaC provider "inherit" requires iac.provider to be set in ${AWS_NX_PLUGIN_CONFIG_FILE_NAME}`,
      );
    }
    if (!IAC_PROVIDERS.includes(pluginConfig.iac.provider)) {
      throw new Error(
        `iac.provider in ${AWS_NX_PLUGIN_CONFIG_FILE_NAME} must be one of ${IAC_PROVIDERS.join(', ')}`,
      );
    }

    return pluginConfig.iac.provider;
  }
  return iacOption;
};
