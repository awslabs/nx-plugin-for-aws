/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from './test';
import { resolveUxProvider, UX_PROVIDERS } from './ux';

describe('ux utils', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  describe('resolveUxProvider', () => {
    it('should return Cloudscape when uxProvider is Cloudscape', async () => {
      const result = await resolveUxProvider(tree, 'Cloudscape');
      expect(result).toBe('Cloudscape');
    });

    it('should return None when uxProvider is None', async () => {
      const result = await resolveUxProvider(tree, 'None');
      expect(result).toBe('None');
    });

    it('should throw error when uxProvider is invalid', async () => {
      await expect(
        resolveUxProvider(tree, 'InvalidProvider' as any),
      ).rejects.toThrow(`uxProvider must be one of ${UX_PROVIDERS.join(', ')}`);
    });
  });
});
