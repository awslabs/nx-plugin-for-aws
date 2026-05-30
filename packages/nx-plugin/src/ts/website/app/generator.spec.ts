/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { tsWebsiteGenerator, TS_WEBSITE_GENERATOR_INFO } from './generator';
import { TsWebsiteGeneratorSchema } from './schema';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';

describe('ts#website generator', () => {
  let tree: Tree;

  const options: TsWebsiteGeneratorSchema = {
    name: 'test-website',
    iacProvider: 'CDK',
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should have correct generator info', () => {
    expect(TS_WEBSITE_GENERATOR_INFO).toBeDefined();
    expect(TS_WEBSITE_GENERATOR_INFO.id).toBe('ts#website');
  });

  it('should delegate to ts#react-website generator with default framework', async () => {
    await tsWebsiteGenerator(tree, options);
    expect(tree.exists('test-website/src/main.tsx')).toBeTruthy();
  });

  it('should delegate to ts#react-website generator with explicit React framework', async () => {
    await tsWebsiteGenerator(tree, { ...options, framework: 'React' });
    expect(tree.exists('test-website/src/main.tsx')).toBeTruthy();
  });

  it('should pass through all options to the underlying generator', async () => {
    await tsWebsiteGenerator(tree, {
      ...options,
      framework: 'React',
      uxProvider: 'Shadcn',
      enableTailwind: true,
      enableTanstackRouter: true,
    });
    expect(tree.exists('test-website/src/main.tsx')).toBeTruthy();
    expect(tree.exists('test-website/src/routes/__root.tsx')).toBeTruthy();
  });

  it('should throw for unsupported framework', async () => {
    await expect(
      tsWebsiteGenerator(tree, {
        ...options,
        framework: 'Vue' as any,
      }),
    ).rejects.toThrow('Unsupported website framework: Vue');
  });
});
