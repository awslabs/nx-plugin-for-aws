/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { Spec } from '../utils/types';
import { PythonVerifier } from '../../utils/test/py.spec';
import {
  callGeneratedClient,
  createTree,
  generateAndRead,
} from './generator.utils.spec';

/**
 * Parity coverage for OpenAPI spec-compliance features mirrored from the
 * ts-client (#922, #930): urlencoded bodies, tuples (3.1 prefixItems),
 * matrix/label path styles, allowReserved query parameters, content-based
 * parameters, and multipart part content types from the encoding object.
 */
describe('openApiPyClientGenerator - spec compliance', () => {
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

  it('sends urlencoded form bodies as key=value pairs, not JSON', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/login': {
          post: {
            operationId: 'login',
            requestBody: {
              required: true,
              content: {
                'application/x-www-form-urlencoded': {
                  schema: {
                    type: 'object',
                    required: ['username', 'password'],
                    properties: {
                      username: { type: 'string' },
                      password: { type: 'string' },
                      remember: { type: 'boolean' },
                      scopes: { type: 'array', items: { type: 'string' } },
                    },
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
                      properties: { username: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const { client } = await generateAndRead(verifier, tree, spec);
    // Must not JSON-encode a urlencoded body.
    expect(client).not.toMatch(/"json": body[\s\S]*?x-www-form-urlencoded/);

    const res = await callGeneratedClient(
      verifier,
      'login',
      {
        username: 'alice',
        password: 'p&w=1',
        remember: true,
        scopes: ['read', 'write'],
      },
      { json: { username: 'alice' } },
    );
    expect(res.ok).toBe(true);
    const contentType = res.calls?.[0]?.headers['content-type'] ?? '';
    expect(contentType).toMatch(/^application\/x-www-form-urlencoded/);
    const body = res.calls?.[0]?.body ?? '';
    // URL-encoded pairs, arrays as repeated keys, not JSON.
    expect(body).not.toMatch(/^\s*\{/);
    expect(body).toContain('username=alice');
    expect(body).toContain('password=p%26w%3D1');
    expect(body).toContain('scopes=read');
    expect(body).toContain('scopes=write');
  });

  it('omits None optional fields from a urlencoded form body', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/login': {
          post: {
            operationId: 'login',
            requestBody: {
              required: true,
              content: {
                'application/x-www-form-urlencoded': {
                  schema: {
                    type: 'object',
                    required: ['username'],
                    properties: {
                      username: { type: 'string' },
                      nickname: { type: 'string' },
                    },
                  },
                },
              },
            },
            responses: { '204': { description: 'No content' } },
          },
        },
      },
    };
    await generateAndRead(verifier, tree, spec);
    const res = await callGeneratedClient(
      verifier,
      'login',
      { username: 'alice' },
      { status: 204 },
    );
    expect(res.ok).toBe(true);
    expect(res.calls?.[0]?.body).toBe('username=alice');
  });

  it('types tuples positionally and round-trips them', async () => {
    const spec: Spec = {
      openapi: '3.1.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/tuples': {
          get: {
            operationId: 'getTuples',
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/TupleOutput' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          TupleOutput: {
            type: 'object',
            required: ['pair', 'points'],
            properties: {
              pair: {
                type: 'array',
                prefixItems: [{ type: 'integer' }, { type: 'string' }],
              },
              points: {
                type: 'array',
                items: {
                  type: 'array',
                  prefixItems: [{ type: 'number' }, { type: 'number' }],
                },
              },
            },
          },
        },
      },
    };
    const { types } = await generateAndRead(verifier, tree, spec);
    expect(types).toContain('pair: tuple[int, str]');
    expect(types).toContain('points: list[tuple[float, float]]');

    const res = await callGeneratedClient(
      verifier,
      'get_tuples',
      {},
      {
        json: {
          pair: [42, 'answer'],
          points: [
            [1, 2],
            [3, 4],
          ],
        },
      },
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({
      pair: [42, 'answer'],
      points: [
        [1, 2],
        [3, 4],
      ],
    });
  });

  it('serialises matrix and label path styles', async () => {
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/resource/{matrixParam}/{labelParam}': {
          get: {
            operationId: 'styled',
            parameters: [
              {
                name: 'matrixParam',
                in: 'path',
                required: true,
                style: 'matrix',
                schema: { type: 'array', items: { type: 'string' } },
              },
              {
                name: 'labelParam',
                in: 'path',
                required: true,
                style: 'label',
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
      'styled',
      { matrix_param: ['a', 'b'], label_param: 'x' },
      { json: 'ok' },
    );
    expect(res.ok).toBe(true);
    const url = decodeURIComponent(res.calls?.[0]?.url ?? '');
    // RFC 6570: ;matrixParam=a,b (non-explode) and .x (label)
    expect(url).toContain('/resource/;matrixParam=a,b/.x');
  });

  it('serialises exploded matrix path styles', async () => {
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/resource/{ids}': {
          get: {
            operationId: 'exploded',
            parameters: [
              {
                name: 'ids',
                in: 'path',
                required: true,
                style: 'matrix',
                explode: true,
                schema: { type: 'array', items: { type: 'string' } },
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
      'exploded',
      { ids: ['a', 'b'] },
      { json: 'ok' },
    );
    expect(res.ok).toBe(true);
    const url = decodeURIComponent(res.calls?.[0]?.url ?? '');
    expect(url).toContain('/resource/;ids=a;ids=b');
  });

  it('keeps reserved characters literal for allowReserved query parameters', async () => {
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/search': {
          get: {
            operationId: 'search',
            parameters: [
              {
                name: 'path',
                in: 'query',
                required: true,
                allowReserved: true,
                schema: { type: 'string' },
              },
              {
                name: 'q',
                in: 'query',
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
      'search',
      { path: 'a/b:c,d', q: 'x y' },
      { json: 'ok' },
    );
    expect(res.ok).toBe(true);
    const url = res.calls?.[0]?.url ?? '';
    // Reserved characters stay literal for `path`; `q` is percent-encoded.
    expect(url).toContain('path=a/b:c,d');
    expect(url).toMatch(/q=x(%20|\+)y/);
  });

  it('JSON-serialises a content-based query parameter', async () => {
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/search': {
          get: {
            operationId: 'search',
            parameters: [
              {
                name: 'filter',
                in: 'query',
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        colour: { type: 'string' },
                        since: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
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
      'search',
      { filter: { colour: 'red' } },
      { json: 'ok' },
    );
    expect(res.ok).toBe(true);
    const url = decodeURIComponent(res.calls?.[0]?.url ?? '');
    // The whole object is a single JSON-serialised query value.
    expect(url).toContain('filter={"colour":"red"}');
  });

  it('sends multipart parts with content types declared by the encoding object', async () => {
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/upload': {
          post: {
            operationId: 'upload',
            requestBody: {
              required: true,
              content: {
                'multipart/form-data': {
                  schema: {
                    type: 'object',
                    required: ['metadata'],
                    properties: {
                      metadata: {
                        type: 'object',
                        properties: { name: { type: 'string' } },
                      },
                      note: { type: 'string' },
                    },
                  },
                  encoding: {
                    metadata: { contentType: 'application/json' },
                  },
                },
              },
            },
            responses: { '204': { description: 'No content' } },
          },
        },
      },
    };
    const { client } = await generateAndRead(verifier, tree, spec);
    expect(client).toContain('"metadata": "application/json"');

    const res = await callGeneratedClient(
      verifier,
      'upload',
      { metadata: { name: 'x' }, note: 'hi' },
      { status: 204 },
    );
    expect(res.ok).toBe(true);
    const body = res.calls?.[0]?.body ?? '';
    // The metadata part declares its JSON content type inside the multipart body.
    expect(body).toContain('application/json');
    expect(body).toContain('{"name":"x"}');
  });
});
