/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../utils/test.js';
import type { Spec } from '../utils/types.js';
import { openApiJsonMetadataGenerator } from './generator.js';

describe('openApiJsonMetadataGenerator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const operationsFor = async (spec: Spec) => {
    tree.write('openapi.json', JSON.stringify(spec));
    await openApiJsonMetadataGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'generated',
    });
    return JSON.parse(tree.read('generated/operations.json', 'utf-8'));
  };

  const okResponse = {
    '200': {
      description: 'ok',
      content: { 'application/json': { schema: { type: 'object' } } },
    },
  };

  it('should write the path and method for each operation', async () => {
    const operations = await operationsFor({
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/items': {
          post: { operationId: 'createItem', responses: okResponse },
        },
        '/items/{itemId}': {
          get: { operationId: 'getItem', responses: okResponse },
        },
      },
    } as Spec);

    expect(operations).toEqual({
      createItem: { path: '/items', method: 'POST' },
      getItem: { path: '/items/{itemId}', method: 'GET' },
    });
  });

  it('should sort operations by name so the file is stable across runs', async () => {
    const operations = await operationsFor({
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/zebra': { get: { operationId: 'zebra', responses: okResponse } },
        '/apple': { get: { operationId: 'apple', responses: okResponse } },
        '/mango': { get: { operationId: 'mango', responses: okResponse } },
      },
    } as Spec);

    expect(Object.keys(operations)).toEqual(['apple', 'mango', 'zebra']);
  });

  it('should disambiguate operations which share an id across tags', async () => {
    const operations = await operationsFor({
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/items/echo': {
          get: {
            operationId: 'echo',
            tags: ['items'],
            responses: okResponse,
          },
        },
        '/users/echo': {
          get: {
            operationId: 'echo',
            tags: ['users'],
            responses: okResponse,
          },
        },
      },
    } as Spec);

    // Tag-qualified names keep the keys unique, so each gets its own function
    expect(operations).toEqual({
      'items.echo': { path: '/items/echo', method: 'GET' },
      'users.echo': { path: '/users/echo', method: 'GET' },
    });
  });
});
