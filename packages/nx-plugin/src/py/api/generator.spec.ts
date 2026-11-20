/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../utils/test.js';
import { pyApiGenerator } from './generator.js';
import { PyApiGeneratorSchema } from './schema';

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

  it('should default the integration pattern to shared for http-ecs', async () => {
    // What `py#api --name=TestApi --infra=http-ecs` gives on its own: neither
    // the schema nor this wrapper fills `integrationPattern` in, so the FastAPI
    // generator resolves it from the infra.
    await pyApiGenerator(tree, {
      name: 'TestApi',
      directory: 'packages',
      infra: 'http-ecs',
      auth: 'iam',
      iac: 'cdk',
    });

    expect(
      tree.exists(
        'packages/common/constructs/src/core/api/ecs-http-endpoint.ts',
      ),
    ).toBeTruthy();
    expect(
      tree.exists(
        'packages/common/constructs/src/app/services/test-api-container.ts',
      ),
    ).toBeTruthy();
    expect(
      tree.read('packages/common/constructs/src/app/apis/test-api.ts', 'utf-8'),
    ).toContain("pattern: 'shared'");
  });
});
