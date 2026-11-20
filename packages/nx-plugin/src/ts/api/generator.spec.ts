/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readProjectConfiguration, type Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../utils/test.js';
import { tsApiGenerator } from './generator.js';
import { TsApiGeneratorSchema } from './schema';

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
      infra: 'rest-lambda',
      integrationPattern: 'isolated',
      auth: 'iam',
      iac: 'cdk',
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
      infra: 'rest-lambda',
      integrationPattern: 'isolated',
      auth: 'iam',
      iac: 'cdk',
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
      infra: 'rest-lambda',
      integrationPattern: 'isolated',
      auth: 'iam',
      iac: 'cdk',
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
      infra: 'rest-lambda',
      integrationPattern: 'isolated',
      auth: 'iam',
      iac: 'cdk',
    });

    expect(tree.exists('packages/test-api/backend')).toBeTruthy();
    expect(tree.exists('packages/test-api/model')).toBeTruthy();
  });

  it('should reject smithy framework with http-lambda infra', async () => {
    await expect(
      tsApiGenerator(tree, {
        name: 'TestApi',
        framework: 'smithy',
        directory: 'packages',
        infra: 'http-lambda' as any,
        integrationPattern: 'isolated',
        auth: 'iam',
        iac: 'cdk',
      }),
    ).rejects.toThrow(/Unsupported infra 'http-lambda' for Smithy/);
  });

  it('should reject smithy framework with http-ecs infra', async () => {
    await expect(
      tsApiGenerator(tree, {
        name: 'TestApi',
        framework: 'smithy',
        directory: 'packages',
        infra: 'http-ecs',
        integrationPattern: 'shared',
        auth: 'iam',
        iac: 'cdk',
      }),
    ).rejects.toThrow(
      /infra 'http-ecs' is not implemented for the smithy framework/,
    );
  });

  it('should delegate http-ecs to ts#trpc-api', async () => {
    await tsApiGenerator(tree, {
      name: 'TestApi',
      framework: 'trpc',
      directory: 'packages',
      infra: 'http-ecs',
      integrationPattern: 'shared',
      auth: 'iam',
      iac: 'cdk',
    });

    expect(
      tree.exists('packages/test-api/src/test-api-container/index.ts'),
    ).toBeTruthy();
    expect(
      tree.exists(
        'packages/common/constructs/src/app/services/test-api-container.ts',
      ),
    ).toBeTruthy();
  });

  it('should default the integration pattern to shared for http-ecs', async () => {
    // What `ts#api --name=TestApi --infra=http-ecs` gives on its own: neither
    // the schema nor this wrapper fills `integrationPattern` in, so the tRPC
    // generator resolves it from the infra.
    await tsApiGenerator(tree, {
      name: 'TestApi',
      framework: 'trpc',
      directory: 'packages',
      infra: 'http-ecs',
      auth: 'iam',
      iac: 'cdk',
    });

    const projectConfig = readProjectConfiguration(tree, '@proj/test-api');
    expect(
      (projectConfig.metadata as Record<string, unknown>).integrationPattern,
    ).toBe('shared');
    expect(
      tree.exists(
        'packages/common/constructs/src/core/api/ecs-http-endpoint.ts',
      ),
    ).toBeTruthy();
  });
});
