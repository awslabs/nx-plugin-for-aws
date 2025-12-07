/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';

export const UX_PROVIDERS = ['None', 'Cloudscape'] as const;

export type UxProvider = (typeof UX_PROVIDERS)[number];

// Kept as an alias for consistency with other option types (e.g., IacProviderOption)
export type UxProviderOption = UxProvider;

/**
 * Configuration for ux
 */
export interface UxConfig {
  /**
   * Default provider for ux
   */
  provider: UxProvider;
}

/**
 * Given a UX provider option, resolve the actual ux provider to use
 */
export const resolveUxProvider = async (
  _tree: Tree,
  uxProvider: UxProviderOption,
): Promise<UxProvider> => {
  if (!UX_PROVIDERS.includes(uxProvider)) {
    throw new Error(`uxProvider must be one of ${UX_PROVIDERS.join(', ')}`);
  }

  return uxProvider;
};
