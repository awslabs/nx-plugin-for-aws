/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import {
  tsWebsiteRuntimeConfigGenerator,
  TS_WEBSITE_RUNTIME_CONFIG_GENERATOR_INFO,
} from './generator';
import { TsWebsiteRuntimeConfigGeneratorSchema } from './schema';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import { tsReactWebsiteGenerator } from '../../react-website/app/generator';

describe('ts#website#runtime-config generator', () => {
  let tree: Tree;

  beforeEach(async () => {
    tree = createTreeUsingTsSolutionSetup();
    await tsReactWebsiteGenerator(tree, {
      name: 'test-website',
      iacProvider: 'CDK',
      uxProvider: 'Cloudscape',
    });
  });

  it('should have correct generator info', () => {
    expect(TS_WEBSITE_RUNTIME_CONFIG_GENERATOR_INFO).toBeDefined();
    expect(TS_WEBSITE_RUNTIME_CONFIG_GENERATOR_INFO.id).toBe(
      'ts#website#runtime-config',
    );
  });

  it('should delegate to runtime-config generator', async () => {
    const options: TsWebsiteRuntimeConfigGeneratorSchema = {
      project: 'test-website',
    };
    await tsWebsiteRuntimeConfigGenerator(tree, options);
    expect(
      tree.exists('test-website/src/components/RuntimeConfig/index.tsx'),
    ).toBeTruthy();
  });
});
