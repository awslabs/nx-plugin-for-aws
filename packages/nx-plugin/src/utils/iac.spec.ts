/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from './test';
import { resolveIacProvider } from './iac';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
  AWS_NX_PLUGIN_CONFIG_FILE_NAME,
} from './config/utils';

describe('iac utils', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  describe('resolveIacProvider', () => {
    it('should return CDK when iacProviderOption is CDK', async () => {
      const result = await resolveIacProvider(tree, 'CDK');
      expect(result).toBe('CDK');
    });

    it('should return Terraform when iacProviderOption is Terraform', async () => {
      const result = await resolveIacProvider(tree, 'Terraform');
      expect(result).toBe('Terraform');
    });

    it('should resolve to CDK when iacProviderOption is Inherit and config has CDK provider', async () => {
      // Set up config with CDK provider
      await ensureAwsNxPluginConfig(tree);
      await updateAwsNxPluginConfig(tree, {
        iac: {
          provider: 'CDK',
        },
      });

      const result = await resolveIacProvider(tree, 'Inherit');
      expect(result).toBe('CDK');
    });

    it('should resolve to Terraform when iacProviderOption is Inherit and config has Terraform provider', async () => {
      // Set up config with Terraform provider
      await ensureAwsNxPluginConfig(tree);
      await updateAwsNxPluginConfig(tree, {
        iac: {
          provider: 'Terraform',
        },
      });

      const result = await resolveIacProvider(tree, 'Inherit');
      expect(result).toBe('Terraform');
    });

    it('should throw error when iacProviderOption is Inherit but no config exists', async () => {
      await expect(resolveIacProvider(tree, 'Inherit')).rejects.toThrow(
        `IaC provider "Inherit" requires iac.provider to be set in ${AWS_NX_PLUGIN_CONFIG_FILE_NAME}`,
      );
    });

    it('should throw error when iacProviderOption is Inherit but config has no iac.provider', async () => {
      // Set up config without iac.provider
      await ensureAwsNxPluginConfig(tree);

      await expect(resolveIacProvider(tree, 'Inherit')).rejects.toThrow(
        `IaC provider "Inherit" requires iac.provider to be set in ${AWS_NX_PLUGIN_CONFIG_FILE_NAME}`,
      );
    });

    it('should throw error when iacProviderOption is Inherit but config has invalid iac.provider', async () => {
      // Set up config with invalid provider
      await ensureAwsNxPluginConfig(tree);
      await updateAwsNxPluginConfig(tree, {
        iac: {
          provider: 'InvalidProvider' as any,
        },
      });

      await expect(resolveIacProvider(tree, 'Inherit')).rejects.toThrow(
        `iac.provider in ${AWS_NX_PLUGIN_CONFIG_FILE_NAME} must be one of CDK, Terraform`,
      );
    });

    it('should throw error when iacProviderOption is Inherit but config has empty iac section', async () => {
      // Set up config with empty iac section
      await ensureAwsNxPluginConfig(tree);
      await updateAwsNxPluginConfig(tree, {
        iac: {} as any,
      });

      await expect(resolveIacProvider(tree, 'Inherit')).rejects.toThrow(
        `IaC provider "Inherit" requires iac.provider to be set in ${AWS_NX_PLUGIN_CONFIG_FILE_NAME}`,
      );
    });
  });
});
