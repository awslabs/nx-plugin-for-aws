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

describe('openApiPyClientGenerator - primitive types', () => {
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

  it('should generate valid Python for primitive types', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/scalars': {
          post: {
            operationId: 'scalars',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Scalars' },
                },
              },
            },
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Scalars' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Scalars: {
            type: 'object',
            required: ['s', 'i', 'b', 'f'],
            properties: {
              s: { type: 'string' },
              i: { type: 'integer' },
              b: { type: 'boolean' },
              f: { type: 'number', format: 'float' },
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
      'scalars',
      { s: 'hi', i: 3, b: true, f: 1.5 },
      { json: { s: 'hi', i: 3, b: true, f: 1.5 } },
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({ s: 'hi', i: 3, b: true, f: 1.5 });
  });

  it('should handle date and date-time formats', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/event': {
          post: {
            operationId: 'event',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Event' },
                },
              },
            },
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Event' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Event: {
            type: 'object',
            required: ['day', 'moment'],
            properties: {
              day: { type: 'string', format: 'date' },
              moment: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    };
    const { types, client } = await generateAndRead(verifier, tree, spec);
    expect(types).toContain('datetime.date');
    expect(types).toContain('datetime.datetime');
    expect(types).toMatchSnapshot('types_gen.py');
    expect(client).toMatchSnapshot('client_gen.py');

    const res = await callGeneratedClient(
      verifier,
      'event',
      { day: '2026-04-18', moment: '2026-04-18T10:00:00' },
      { json: { day: '2026-04-18', moment: '2026-04-18T10:00:00' } },
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({
      day: '2026-04-18',
      moment: '2026-04-18T10:00:00',
    });
  });

  it('should handle enum request and response bodies', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/status': {
          post: {
            operationId: 'setStatus',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Status' },
                },
              },
            },
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Status' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Status: { type: 'string', enum: ['placed', 'approved', 'delivered'] },
        },
      },
    };
    const { types, client } = await generateAndRead(verifier, tree, spec);
    // Top-level enum becomes a Literal alias
    expect(types).toContain(
      'Status = Literal["placed", "approved", "delivered"]',
    );
    expect(types).toMatchSnapshot('types_gen.py');
    expect(client).toMatchSnapshot('client_gen.py');
  });

  it('should handle inline integer enums on properties', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/priority': {
          post: {
            operationId: 'priority',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Holder' },
                },
              },
            },
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Holder' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Holder: {
            type: 'object',
            required: ['p'],
            properties: {
              p: { type: 'integer', enum: [1, 2, 3] },
            },
          },
        },
      },
    };
    const { types } = await generateAndRead(verifier, tree, spec);
    expect(types).toContain('p: Literal[1, 2, 3]');
    expect(types).toMatchSnapshot('types_gen.py');

    const res = await callGeneratedClient(
      verifier,
      'priority',
      { p: 2 },
      { json: { p: 2 } },
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({ p: 2 });
  });

  it('should handle nullable schemas via type arrays (OpenAPI 3.1)', async () => {
    const spec: Spec = {
      openapi: '3.1.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/nullable': {
          post: {
            operationId: 'nullable',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/N' },
                },
              },
            },
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/N' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          N: {
            type: 'object',
            required: ['a'],
            properties: { a: { type: ['string', 'null'] } },
          },
        },
      },
    };
    const { types } = await generateAndRead(verifier, tree, spec);
    expect(types).toContain('Optional[str]');

    const res = await callGeneratedClient(
      verifier,
      'nullable',
      { a: null },
      { json: { a: null } },
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({ a: null });
  });

  it('should handle binary response bodies', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/blob': {
          get: {
            operationId: 'blob',
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/octet-stream': {
                    schema: { type: 'string', format: 'binary' },
                  },
                },
              },
            },
          },
        },
      },
    };
    const { client } = await generateAndRead(verifier, tree, spec);
    // Response parsing uses .content for binary
    expect(client).toContain('response.content');
  });

  it('should handle primitive scalar response types (text)', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/greet': {
          get: {
            operationId: 'greet',
            responses: {
              '200': {
                description: 'OK',
                content: { 'text/plain': { schema: { type: 'string' } } },
              },
            },
          },
        },
      },
    };
    const { client } = await generateAndRead(verifier, tree, spec);
    expect(client).toMatchSnapshot('client_gen.py');
  });
});
