/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { declareDependencies } from '../../utils/declared-dependencies';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../utils/shared-constructs';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import {
  OPEN_API_PY_CLIENT_GENERATOR_INFO,
  openApiPyClientGenerator,
} from './generator';

const sharedConstructsDeclaration = declareDependencies()({
  ts: [...SHARED_CONSTRUCTS_DEPENDENCIES],
});

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
    // The package must only export what it emitted, or importing it fails.
    const init = tree.read('src/generated/__init__.py', 'utf-8') ?? '';
    expect(init).toContain('from .client_gen import TestApi');
    expect(init).not.toContain('async_client_gen');
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
    const init = tree.read('src/generated/__init__.py', 'utf-8') ?? '';
    expect(init).toContain('from .async_client_gen import AsyncTestApi');
    expect(init).not.toMatch(/from \.client_gen import/);
  });

  // The errors module is shared by both clients, so it is emitted whichever
  // client flavours are asked for.
  it.each(['sync', 'async', 'both'] as const)(
    'emits importable errors.py for clientType %s',
    async (clientType) => {
      tree.write('openapi.json', JSON.stringify(trivialSpec));
      await openApiPyClientGenerator(tree, {
        openApiSpecPath: 'openapi.json',
        outputPath: 'src/generated',
        clientType,
      });
      const errors = tree.read('src/generated/errors.py', 'utf-8') ?? '';
      expect(errors).toContain('class ApiError(Exception)');
      expect(errors).toContain('class PingApiError(ApiError)');
    },
  );

  it('adds generator metric to app.ts', async () => {
    await sharedConstructsGenerator(
      tree,
      { iac: 'cdk' },
      sharedConstructsDeclaration,
    );
    tree.write('openapi.json', JSON.stringify(trivialSpec));
    await openApiPyClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });
    expectHasMetricTags(tree, OPEN_API_PY_CLIENT_GENERATOR_INFO.metric);
  });
});
