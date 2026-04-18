/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import {
  openApiPyClientGenerator,
  OPEN_API_PY_CLIENT_GENERATOR_INFO,
} from './generator';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';

const trivialSpec = {
  openapi: '3.0.0',
  info: { title: 'TestApi', version: '1.0.0' },
  paths: {
    '/ping': {
      get: {
        operationId: 'ping',
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { type: 'string' } } },
          },
        },
      },
    },
  },
};

describe('openApiPyClientGenerator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('emits the expected files when clientType is "both"', async () => {
    tree.write('openapi.json', JSON.stringify(trivialSpec));
    await openApiPyClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });
    expect(tree.exists('src/generated/__init__.py')).toBe(true);
    expect(tree.exists('src/generated/types_gen.py')).toBe(true);
    expect(tree.exists('src/generated/client_gen.py')).toBe(true);
    expect(tree.exists('src/generated/async_client_gen.py')).toBe(true);
  });

  it('omits async_client_gen.py when clientType is "sync"', async () => {
    tree.write('openapi.json', JSON.stringify(trivialSpec));
    await openApiPyClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
      clientType: 'sync',
    });
    expect(tree.exists('src/generated/client_gen.py')).toBe(true);
    expect(tree.exists('src/generated/async_client_gen.py')).toBe(false);
  });

  it('omits client_gen.py when clientType is "async"', async () => {
    tree.write('openapi.json', JSON.stringify(trivialSpec));
    await openApiPyClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
      clientType: 'async',
    });
    expect(tree.exists('src/generated/client_gen.py')).toBe(false);
    expect(tree.exists('src/generated/async_client_gen.py')).toBe(true);
  });

  it('adds generator metric to app.ts', async () => {
    await sharedConstructsGenerator(tree, { iacProvider: 'CDK' });
    tree.write('openapi.json', JSON.stringify(trivialSpec));
    await openApiPyClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });
    expectHasMetricTags(tree, OPEN_API_PY_CLIENT_GENERATOR_INFO.metric);
  });
});
