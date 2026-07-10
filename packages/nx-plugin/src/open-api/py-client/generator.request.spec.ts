/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { Spec } from '../utils/types';
import { PythonVerifier } from '../../utils/test/py.spec';
import {
  callGeneratedClient,
  callGeneratedClientAsync,
  createTree,
  generateAndRead,
} from './generator.utils.spec';

describe('openApiPyClientGenerator - requests', () => {
  let tree: Tree;
  let verifier: PythonVerifier;

  beforeAll(() => {
    verifier = new PythonVerifier();
  });

  afterAll(async () => {
    await verifier.shutdown();
  });

  beforeEach(() => {
    tree = createTree();
  });

  it('should generate valid Python for parameters and responses', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/test/{id}': {
          get: {
            operationId: 'getTest',
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
              {
                name: 'filter',
                in: 'query',
                schema: { type: 'string' },
              },
              {
                name: 'tags',
                in: 'query',
                explode: true,
                schema: { type: 'array', items: { type: 'string' } },
              },
              {
                name: 'x-api-key',
                in: 'header',
                required: true,
                schema: { type: 'string' },
              },
            ],
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['result'],
                      properties: { result: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const { types, client } = await generateAndRead(verifier, tree, spec);
    expect(types).toMatchSnapshot('types_gen.py');
    expect(client).toMatchSnapshot('client_gen.py');

    const res = await callGeneratedClient(
      verifier,
      'get_test',
      {
        id: 'test123',
        filter: 'active',
        tags: ['tag1', 'tag2'],
        x_api_key: 'api-key-123',
      },
      { status: 200, json: { result: 'success' } },
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({ result: 'success' });
    expect(res.calls?.[0]?.url).toContain('/test/test123');
    expect(res.calls?.[0]?.url).toMatch(/filter=active/);
    expect(res.calls?.[0]?.url).toMatch(/tags=tag1/);
    expect(res.calls?.[0]?.url).toMatch(/tags=tag2/);
    expect(res.calls?.[0]?.headers['x-api-key']).toBe('api-key-123');
  });

  it('should encode path parameters containing URL-unsafe characters', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/widget/{id}': {
          get: {
            operationId: 'widget',
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
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
    await generateAndRead(verifier, tree, spec);
    const res = await callGeneratedClient(
      verifier,
      'widget',
      { id: 'a b/c' },
      { json: 'ok' },
    );
    expect(res.ok).toBe(true);
    expect(res.calls?.[0]?.url).toContain('/widget/a%20b%2Fc');
  });

  it('should handle operations with simple request bodies and query parameters', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/test': {
          post: {
            operationId: 'postTest',
            parameters: [
              {
                name: 'filter',
                in: 'query',
                required: true,
                schema: { type: 'string' },
              },
            ],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Body' },
                },
              },
            },
            responses: {
              '200': {
                description: 'OK',
                content: { 'application/json': { schema: { type: 'string' } } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Body: {
            type: 'object',
            required: ['data'],
            properties: { data: { type: 'string' } },
          },
        },
      },
    };
    const { client } = await generateAndRead(verifier, tree, spec);
    // Body fields are flattened into the request as kwargs alongside `filter`.
    expect(client).toMatch(/filter:\s*str/);
    expect(client).toMatch(/data:\s*str/);

    const res = await callGeneratedClient(
      verifier,
      'post_test',
      { filter: 'active', data: 'hello' },
      { json: 'ok' },
    );
    expect(res.ok).toBe(true);
    expect(res.calls?.[0]?.url).toMatch(/filter=active/);
    expect(JSON.parse(res.calls?.[0]?.body ?? '{}')).toEqual({ data: 'hello' });
  });

  it('async client round-trips the same parameters', async () => {
    const spec: Spec = {
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
    await generateAndRead(verifier, tree, spec);
    const res = await callGeneratedClientAsync(
      verifier,
      'ping',
      {},
      { json: 'pong' },
    );
    expect(res.ok).toBe(true);
    expect(res.value).toBe('pong');
  });
});
