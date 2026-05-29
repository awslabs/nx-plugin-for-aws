/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from './test';
import { resolveContainerEngine } from './containers';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
  AWS_NX_PLUGIN_CONFIG_FILE_NAME,
} from './config/utils';

describe('containers utils', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  describe('resolveContainerEngine', () => {
    it('should return docker when option is docker', async () => {
      const result = await resolveContainerEngine(tree, 'docker');
      expect(result).toBe('docker');
    });

    it('should return finch when option is finch', async () => {
      const result = await resolveContainerEngine(tree, 'finch');
      expect(result).toBe('finch');
    });

    it('should resolve to configured engine when option is Inherit', async () => {
      await ensureAwsNxPluginConfig(tree);
      await updateAwsNxPluginConfig(tree, {
        containers: { engine: 'finch' },
      });
      const result = await resolveContainerEngine(tree, 'Inherit');
      expect(result).toBe('finch');
    });

    it('should default to docker when option is Inherit and no config exists', async () => {
      const result = await resolveContainerEngine(tree, 'Inherit');
      expect(result).toBe('docker');
    });

    it('should default to docker when option is Inherit and config has no containers section', async () => {
      await ensureAwsNxPluginConfig(tree);
      const result = await resolveContainerEngine(tree, 'Inherit');
      expect(result).toBe('docker');
    });

    it('should throw when configured engine is invalid', async () => {
      await ensureAwsNxPluginConfig(tree);
      await updateAwsNxPluginConfig(tree, {
        containers: { engine: 'podman' as any },
      });
      await expect(resolveContainerEngine(tree, 'Inherit')).rejects.toThrow(
        `containers.engine in ${AWS_NX_PLUGIN_CONFIG_FILE_NAME} must be one of docker, finch`,
      );
    });
  });
});
