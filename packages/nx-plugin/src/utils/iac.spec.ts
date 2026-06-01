/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from './test';
import { resolveIac } from './iac';
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

  describe('resolveIac', () => {
    it('should return CDK when iacOption is CDK', async () => {
      const result = await resolveIac(tree, 'cdk');
      expect(result).toBe('cdk');
    });

    it('should return Terraform when iacOption is Terraform', async () => {
      const result = await resolveIac(tree, 'terraform');
      expect(result).toBe('terraform');
    });

    it('should resolve to CDK when iacOption is Inherit and config has CDK provider', async () => {
      // Set up config with CDK provider
      await ensureAwsNxPluginConfig(tree);
      await updateAwsNxPluginConfig(tree, {
        iac: {
          provider: 'cdk',
        },
      });

      const result = await resolveIac(tree, 'inherit');
      expect(result).toBe('cdk');
    });

    it('should resolve to Terraform when iacOption is Inherit and config has Terraform provider', async () => {
      // Set up config with Terraform provider
      await ensureAwsNxPluginConfig(tree);
      await updateAwsNxPluginConfig(tree, {
        iac: {
          provider: 'terraform',
        },
      });

      const result = await resolveIac(tree, 'inherit');
      expect(result).toBe('terraform');
    });

    it('should throw error when iacOption is Inherit but no config exists', async () => {
      await expect(resolveIac(tree, 'inherit')).rejects.toThrow(
        `IaC provider "inherit" requires iac.provider to be set in ${AWS_NX_PLUGIN_CONFIG_FILE_NAME}`,
      );
    });

    it('should throw error when iacOption is Inherit but config has no iac.provider', async () => {
      // Set up config without iac.provider
      await ensureAwsNxPluginConfig(tree);

      await expect(resolveIac(tree, 'inherit')).rejects.toThrow(
        `IaC provider "inherit" requires iac.provider to be set in ${AWS_NX_PLUGIN_CONFIG_FILE_NAME}`,
      );
    });

    it('should throw error when iacOption is Inherit but config has invalid iac.provider', async () => {
      // Set up config with invalid provider
      await ensureAwsNxPluginConfig(tree);
      await updateAwsNxPluginConfig(tree, {
        iac: {
          provider: 'InvalidProvider' as any,
        },
      });

      await expect(resolveIac(tree, 'inherit')).rejects.toThrow(
        `iac.provider in ${AWS_NX_PLUGIN_CONFIG_FILE_NAME} must be one of cdk, terraform`,
      );
    });

    it('should throw error when iacOption is Inherit but config has empty iac section', async () => {
      // Set up config with empty iac section
      await ensureAwsNxPluginConfig(tree);
      await updateAwsNxPluginConfig(tree, {
        iac: {} as any,
      });

      await expect(resolveIac(tree, 'inherit')).rejects.toThrow(
        `IaC provider "inherit" requires iac.provider to be set in ${AWS_NX_PLUGIN_CONFIG_FILE_NAME}`,
      );
    });
  });
});
