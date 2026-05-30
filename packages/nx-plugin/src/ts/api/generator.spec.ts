/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { tsApiGenerator } from './generator';
import { TsApiGeneratorSchema } from './schema';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';

describe('ts#api generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should delegate to ts#trpc-api when framework is trpc', async () => {
    await tsApiGenerator(tree, {
      name: 'TestApi',
      framework: 'trpc',
      directory: 'packages',
      computeType: 'ServerlessApiGatewayRestApi',
      integrationPattern: 'isolated',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    expect(tree.exists('packages/test-api')).toBeTruthy();
    expect(tree.exists('packages/test-api/src/index.ts')).toBeTruthy();

    const projectConfig = JSON.parse(
      tree.read('packages/test-api/project.json', 'utf-8'),
    );
    expect(projectConfig.metadata.apiType).toBe('trpc');
  });

  it('should default to trpc when framework is not specified', async () => {
    await tsApiGenerator(tree, {
      name: 'TestApi',
      directory: 'packages',
      computeType: 'ServerlessApiGatewayRestApi',
      integrationPattern: 'isolated',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    expect(tree.exists('packages/test-api')).toBeTruthy();

    const projectConfig = JSON.parse(
      tree.read('packages/test-api/project.json', 'utf-8'),
    );
    expect(projectConfig.metadata.apiType).toBe('trpc');
  });

  it('should delegate to ts#smithy-api when framework is smithy', async () => {
    await tsApiGenerator(tree, {
      name: 'TestApi',
      framework: 'smithy',
      directory: 'packages',
      computeType: 'ServerlessApiGatewayRestApi',
      integrationPattern: 'isolated',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    expect(tree.exists('packages/test-api/backend')).toBeTruthy();
    expect(tree.exists('packages/test-api/model')).toBeTruthy();

    const projectConfig = JSON.parse(
      tree.read('packages/test-api/backend/project.json', 'utf-8'),
    );
    expect(projectConfig.metadata.generator).toBe('ts#smithy-api');
  });

  it('should pass namespace to smithy generator', async () => {
    await tsApiGenerator(tree, {
      name: 'TestApi',
      framework: 'smithy',
      namespace: 'com.example',
      directory: 'packages',
      computeType: 'ServerlessApiGatewayRestApi',
      integrationPattern: 'isolated',
      auth: 'IAM',
      iacProvider: 'CDK',
    });

    expect(tree.exists('packages/test-api/backend')).toBeTruthy();
    expect(tree.exists('packages/test-api/model')).toBeTruthy();
  });
});
