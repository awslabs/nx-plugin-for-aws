/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import {
  tsWebsiteAuthGenerator,
  TS_WEBSITE_AUTH_GENERATOR_INFO,
} from './generator';
import { TsWebsiteAuthGeneratorSchema } from './schema';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import { tsReactWebsiteGenerator } from '../../react-website/app/generator';

describe('ts#website#auth generator', () => {
  let tree: Tree;

  beforeEach(async () => {
    tree = createTreeUsingTsSolutionSetup();
    await tsReactWebsiteGenerator(tree, {
      name: 'test-website',
      iac: 'cdk',
      ux: 'cloudscape',
    });
  });

  it('should have correct generator info', () => {
    expect(TS_WEBSITE_AUTH_GENERATOR_INFO).toBeDefined();
    expect(TS_WEBSITE_AUTH_GENERATOR_INFO.id).toBe('ts#website#auth');
  });

  it('should delegate to ts#react-website#auth generator', async () => {
    const options: TsWebsiteAuthGeneratorSchema = {
      project: 'test-website',
      allowSignup: false,
      iac: 'cdk',
    };
    await tsWebsiteAuthGenerator(tree, options);
    expect(
      tree.exists('test-website/src/components/CognitoAuth/index.tsx'),
    ).toBeTruthy();
  });
});
