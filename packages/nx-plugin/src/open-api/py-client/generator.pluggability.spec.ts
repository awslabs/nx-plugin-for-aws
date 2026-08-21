/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { PythonVerifier } from '../../utils/test/py.spec';
import type { Spec } from '../utils/types';
import {
  callGeneratedClient,
  createTree,
  expectSingleRequest,
  generateAndRead,
} from './generator.utils.spec';

/**
 * The client's extension point is the caller's own `httpx` client: auth,
 * transports, event hooks, timeouts and retries all come from there, mirroring
 * the custom `fetch` the ts-client accepts. These tests pin that contract,
 * since a generated client that quietly bypasses the supplied client would
 * take every auth strategy with it.
 */
const spec: Spec = {
  openapi: '3.0.3',
  info: { title: 'PlugApi', version: '1.0.0' },
  paths: {
    '/things/{id}': {
      get: {
        operationId: 'getThing',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
          { name: 'trace', in: 'header', schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Thing' },
              },
            },
          },
        },
      },
    },
    '/reserved': {
      get: {
        operationId: 'searchReserved',
        parameters: [
          {
            name: 'q',
            in: 'query',
            allowReserved: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Thing' },
              },
            },
          },
        },
      },
    },
    '/things': {
      post: {
        operationId: 'createThing',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Thing' },
            },
          },
        },
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Thing' },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Thing: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' } },
      },
    },
  },
};

describe('openApiPyClientGenerator - pluggability', () => {
  let tree: Tree;
  let verifier: PythonVerifier;

  beforeAll(() => {
    verifier = new PythonVerifier();
  });

  afterAll(async () => {
    await verifier.shutdown();
  });

  beforeEach(async () => {
    tree = createTree();
    await generateAndRead(verifier, tree, spec);
  });

  it('sends headers set by the caller httpx client', async () => {
    const res = await verifier.invoke({
      module: 'sync',
      method: 'get_thing',
      kwargs: { id: 'a' },
      mock: [{ response: { json: { name: 'x' } } }],
      httpxClientKwargs: { headers: { authorization: 'Bearer from-client' } },
    });
    expect(res.ok).toBe(true);
    expect(expectSingleRequest(res).headers.authorization).toBe(
      'Bearer from-client',
    );
  });

  it('lets an httpx.Auth sign the request, body included', async () => {
    const res = await verifier.invoke({
      module: 'sync',
      method: 'create_thing',
      kwargs: { name: 'signed' },
      mock: [{ response: { json: { name: 'signed' } } }],
      // Signs with a digest of the body, so a client that bypassed the auth
      // flow — or sent a different body — could not produce this header.
      auth: 'body-digest',
    });
    expect(res.ok).toBe(true);
    const call = expectSingleRequest(res);
    expect(call.headers['x-body-digest']).toBe(
      JSON.stringify({ name: 'signed' }),
    );
  });

  it('runs the caller httpx client event hooks', async () => {
    const res = await verifier.invoke({
      module: 'sync',
      method: 'get_thing',
      kwargs: { id: 'a' },
      mock: [{ response: { json: { name: 'x' } } }],
      eventHookHeader: 'x-hooked',
    });
    expect(res.ok).toBe(true);
    expect(expectSingleRequest(res).headers['x-hooked']).toBe('yes');
  });

  it('sends query params configured on the caller httpx client', async () => {
    const res = await verifier.invoke({
      module: 'sync',
      method: 'get_thing',
      kwargs: { id: 'a' },
      mock: [{ response: { json: { name: 'x' } } }],
      httpxClientKwargs: { params: { api_key: 'K' } },
    });
    expect(res.ok).toBe(true);
    expect(expectSingleRequest(res).url).toContain('api_key=K');
  });

  // An allowReserved operation builds its own query string, which httpx would
  // otherwise replace with one rebuilt from the client's params.
  it('keeps both client params and reserved characters on an allowReserved query', async () => {
    const res = await verifier.invoke({
      module: 'sync',
      method: 'search_reserved',
      kwargs: { q: 'a/b:c' },
      mock: [{ response: { json: { name: 'x' } } }],
      httpxClientKwargs: { params: { api_key: 'K' } },
    });
    expect(res.ok).toBe(true);
    const url = expectSingleRequest(res).url;
    expect(url).toContain('api_key=K');
    expect(url).toContain('q=a/b:c');
  });

  it('runs auth and event hooks on an allowReserved operation too', async () => {
    const res = await verifier.invoke({
      module: 'sync',
      method: 'search_reserved',
      kwargs: { q: 'a/b:c' },
      mock: [{ response: { json: { name: 'x' } } }],
      auth: 'body-digest',
      eventHookHeader: 'x-hooked',
    });
    expect(res.ok).toBe(true);
    const call = expectSingleRequest(res);
    expect(call.headers['x-hooked']).toBe('yes');
    expect(call.headers['x-body-digest']).toBe('');
  });

  it('applies config headers where the operation sets none', async () => {
    const res = await callGeneratedClient(
      verifier,
      'get_thing',
      { id: 'a' },
      { json: { name: 'x' } },
      [],
      { headers: { authorization: 'Bearer from-config' } },
    );
    expect(res.ok).toBe(true);
    expect(expectSingleRequest(res).headers.authorization).toBe(
      'Bearer from-config',
    );
  });

  // httpx comma-joins repeated header names, so a config header must give way
  // to the operation's own rather than merging into a corrupt value.
  it('lets an operation header override the same config header', async () => {
    const res = await callGeneratedClient(
      verifier,
      'get_thing',
      { id: 'a', trace: 'from-operation' },
      { json: { name: 'x' } },
      [],
      { headers: { trace: 'from-config' } },
    );
    expect(res.ok).toBe(true);
    expect(expectSingleRequest(res).headers.trace).toBe('from-operation');
  });

  // An httpx client is commonly shared (one auth flow, one connection pool), so
  // closing one generated client must not close a client it doesn't own.
  it('leaves a caller-supplied httpx client open when the client closes', async () => {
    const res = await verifier.invoke({
      module: 'sync',
      method: 'get_thing',
      kwargs: { id: 'a' },
      mock: [{ response: { json: { name: 'x' } } }],
      closeThenReuse: true,
    });
    expect(res.ok).toBe(true);
    expect(res.value).toMatchObject({ name: 'x' });
  });

  it.each(['sync', 'async'] as const)(
    'does not warn on %s requests without cookie parameters',
    async (module) => {
      const res = await verifier.invoke({
        module,
        method: 'get_thing',
        kwargs: { id: 'a' },
        mock: [{ response: { json: { name: 'x' } } }],
        // httpx deprecates per-request cookies, warning even for an empty dict,
        // so the kwarg is only passed where the operation declares cookies.
        errorOnWarning: true,
      });
      expect(res.ok).toBe(true);
    },
  );
});
