/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { pyApiGenerator } from './generator';
import { PyApiGeneratorSchema } from './schema';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';

describe('py#api generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should delegate to py#fast-api when framework is fastapi', async () => {
    await pyApiGenerator(tree, {
      name: 'TestApi',
      framework: 'fastapi',
      directory: 'packages',
      infra: 'rest-lambda',
      integrationPattern: 'isolated',
      auth: 'iam',
      iac: 'cdk',
    });

    expect(tree.exists('packages/test_api')).toBeTruthy();

    const projectConfig = JSON.parse(
      tree.read('packages/test_api/project.json', 'utf-8'),
    );
    expect(projectConfig.metadata.apiType).toBe('fast-api');
  });

  it('should default to fastapi when framework is not specified', async () => {
    await pyApiGenerator(tree, {
      name: 'TestApi',
      directory: 'packages',
      infra: 'rest-lambda',
      integrationPattern: 'isolated',
      auth: 'iam',
      iac: 'cdk',
    });

    expect(tree.exists('packages/test_api')).toBeTruthy();

    const projectConfig = JSON.parse(
      tree.read('packages/test_api/project.json', 'utf-8'),
    );
    expect(projectConfig.metadata.apiType).toBe('fast-api');
  });
});
