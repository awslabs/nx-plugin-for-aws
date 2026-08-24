/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import type { Spec } from '../utils/types';
import {
  callGeneratedClient,
  callGeneratedClientAsync,
  createPythonClientVerifier,
  createTree,
  generateAndRead,
  requestHeader,
} from './generator.utils.spec';

/**
 * A client emitted on its own has to work on its own. `clientType` was only
 * checked by asserting which files exist, so a `sync`-only or `async`-only
 * client that didn't import or run would still have passed.
 */
const spec: Spec = {
  openapi: '3.0.0',
  info: { title: 'TestApi', version: '1.0.0' },
  paths: {
    '/pets/{id}': {
      put: {
        operationId: 'updatePet',
        tags: ['pet'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: { name: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: { name: { type: 'string' } },
                },
              },
            },
          },
          '404': { description: 'Missing' },
        },
      },
    },
  },
};

describe('openApiPyClientGenerator - clientType', () => {
  let tree: Tree;
  const verifier = createPythonClientVerifier();

  beforeEach(() => {
    tree = createTree();
  });

  it('calls an operation on a sync-only client', async () => {
    await generateAndRead(verifier, tree, spec, { clientType: 'sync' });
    const res = await callGeneratedClient(
      verifier,
      'pet.update_pet',
      { id: 'a', name: 'rex' },
      { json: { name: 'rex' } },
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({ name: 'rex' });
  });

  it('calls an operation on an async-only client', async () => {
    await generateAndRead(verifier, tree, spec, { clientType: 'async' });
    const res = await callGeneratedClientAsync(
      verifier,
      'pet.update_pet',
      { id: 'a', name: 'rex' },
      { json: { name: 'rex' } },
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({ name: 'rex' });
  });

  // The shared error module is emitted for every variant, so an error raised by
  // a lone client still narrows through the same hierarchy.
  it.each(['sync', 'async', 'both'] as const)(
    'raises the shared ApiError from a %s client',
    async (clientType) => {
      await generateAndRead(verifier, tree, spec, { clientType });
      const module = clientType === 'async' ? 'async' : 'sync';
      const res = await verifier.invoke({
        module,
        method: 'pet.update_pet',
        kwargs: { id: 'a', name: 'rex' },
        mock: [{ response: { status: 404 } }],
        routes: [{ method: 'PUT', path: '/pets/{id}' }],
        catchAs: 'ApiError',
      });
      expect(res.ok).toBe(false);
      expect(res.exception?.caught_as).toBe(true);
      expect(res.exception?.status).toBe(404);
    },
  );

  it.each(['sync', 'async'] as const)(
    'accepts a caller-supplied httpx client on a %s-only client',
    async (clientType) => {
      await generateAndRead(verifier, tree, spec, { clientType });
      const res = await verifier.invoke({
        module: clientType,
        method: 'pet.update_pet',
        kwargs: { id: 'a', name: 'rex' },
        mock: [{ response: { json: { name: 'rex' } } }],
        routes: [{ method: 'PUT', path: '/pets/{id}' }],
        eventHookHeader: 'x-from-hook',
      });
      expect(res.ok).toBe(true);
      expect(requestHeader(res, 'x-from-hook')).toBeDefined();
    },
  );
});
