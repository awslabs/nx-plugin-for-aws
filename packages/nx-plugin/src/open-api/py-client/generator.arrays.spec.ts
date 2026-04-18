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

describe('openApiPyClientGenerator - arrays', () => {
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

  it('should handle operation which accepts an array of strings', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/process-tags': {
          post: {
            operationId: 'processTags',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { type: 'array', items: { type: 'string' } },
                },
              },
            },
            responses: {
              '200': {
                description: 'Success',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['processed'],
                      properties: { processed: { type: 'integer' } },
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
      'process_tags',
      {},
      { json: { processed: 3 } },
      [['tag1', 'tag2', 'tag3']],
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({ processed: 3 });
    expect(res.calls?.[0]?.body).toEqual(
      JSON.stringify(['tag1', 'tag2', 'tag3']),
    );
  });

  it('should handle operation which accepts an array of objects', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/create-users': {
          post: {
            operationId: 'createUsers',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/User' },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Success',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/User' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          User: {
            type: 'object',
            required: ['username'],
            properties: {
              username: { type: 'string' },
              email: { type: 'string' },
            },
          },
        },
      },
    };
    const { types, client } = await generateAndRead(verifier, tree, spec);
    expect(types).toMatchSnapshot('types_gen.py');
    expect(client).toMatchSnapshot('client_gen.py');

    const users = [
      { username: 'alice', email: 'a@ex.com' },
      { username: 'bob', email: 'b@ex.com' },
    ];
    const res = await callGeneratedClient(
      verifier,
      'create_users',
      {},
      { json: users },
      // `createUsers` is a body-only list operation so the body is positional.
      // We pass the list as the positional argument.
      [users],
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual(users);
  });

  it('should handle operation which returns an array of strings', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/tags': {
          get: {
            operationId: 'listTags',
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    };
    const { client } = await generateAndRead(verifier, tree, spec);
    expect(client).toContain('TypeAdapter(list[str]).validate_python');

    const res = await callGeneratedClient(
      verifier,
      'list_tags',
      {},
      { json: ['a', 'b', 'c'] },
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual(['a', 'b', 'c']);
  });

  it('should handle operation which returns an array of objects', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/User' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          User: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'integer' } },
          },
        },
      },
    };
    const { types, client } = await generateAndRead(verifier, tree, spec);
    expect(types).toMatchSnapshot('types_gen.py');
    expect(client).toMatchSnapshot('client_gen.py');

    const res = await callGeneratedClient(
      verifier,
      'list_users',
      {},
      { json: [{ id: 1 }, { id: 2 }] },
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('should handle operation which returns a nested array of strings', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/matrix': {
          get: {
            operationId: 'getMatrix',
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: {
                        type: 'array',
                        items: { type: 'string' },
                      },
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
    expect(client).toContain('list[list[str]]');

    const res = await callGeneratedClient(
      verifier,
      'get_matrix',
      {},
      {
        json: [
          ['a', 'b'],
          ['c', 'd'],
        ],
      },
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('should handle dictionary (additionalProperties) responses', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/counts': {
          get: {
            operationId: 'getCounts',
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      additionalProperties: { type: 'integer' },
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
      'get_counts',
      {},
      { json: { a: 1, b: 2 } },
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({ a: 1, b: 2 });
  });
});
