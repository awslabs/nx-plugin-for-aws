/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import type { Spec } from '../utils/types.js';
import { openApiPyClientGenerator } from './generator.js';
import {
  callGeneratedClient,
  createPythonClientVerifier,
  createTree,
  generateAndRead,
  outputPath,
} from './generator.utils.spec.js';

describe('openApiPyClientGenerator - complex types', () => {
  let tree: Tree;
  const verifier = createPythonClientVerifier();

  beforeEach(() => {
    tree = createTree();
  });

  it('should handle nested objects', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/outer': {
          post: {
            operationId: 'outer',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Outer' },
                },
              },
            },
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Outer' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Inner: {
            type: 'object',
            required: ['n'],
            properties: { n: { type: 'integer' } },
          },
          Outer: {
            type: 'object',
            required: ['inner'],
            properties: { inner: { $ref: '#/components/schemas/Inner' } },
          },
        },
      },
    };
    const { types } = await generateAndRead(verifier, tree, spec);
    expect(types).toMatchSnapshot('types.py');

    const res = await callGeneratedClient(
      verifier,
      'outer',
      { inner: { n: 42 } },
      { json: { inner: { n: 42 } } },
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({ inner: { n: 42 } });
  });

  it('should handle nullable schemas in various contexts', async () => {
    const spec: Spec = {
      openapi: '3.1.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/x': {
          post: {
            operationId: 'x',
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
            properties: {
              a: { type: ['string', 'null'] },
              b: { type: 'integer' },
            },
          },
        },
      },
    };
    const { types } = await generateAndRead(verifier, tree, spec);
    expect(types).toMatchSnapshot('types.py');

    const res = await callGeneratedClient(
      verifier,
      'x',
      { a: null, b: 1 },
      { json: { a: null, b: 1 } },
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({ a: null, b: 1 });
  });

  it('should handle operations with complex map types', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/maps': {
          post: {
            operationId: 'maps',
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/MapsResponse' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          MapsResponse: {
            type: 'object',
            required: ['byId'],
            properties: {
              byId: {
                type: 'object',
                additionalProperties: {
                  type: 'object',
                  required: ['name'],
                  properties: { name: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    };
    const { types } = await generateAndRead(verifier, tree, spec);
    expect(types).toMatchSnapshot('types.py');

    const res = await callGeneratedClient(
      verifier,
      'maps',
      {},
      { json: { byId: { '1': { name: 'a' }, '2': { name: 'b' } } } },
    );
    expect(res.ok).toBe(true);
  });

  // A member's nullability is not the collection's: `list[str | None]` is a list
  // that is always present whose items may be null. Dropping it made a valid
  // response containing `null` fail to parse; TypeScript already rendered it.
  it('keeps a nullable collection member optional', async () => {
    const spec: Spec = {
      openapi: '3.1.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/h': {
          get: {
            operationId: 'getH',
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
          Leaf: {
            type: 'object',
            required: ['v'],
            properties: { v: { type: 'integer' } },
          },
          Holder: {
            type: 'object',
            required: ['ints', 'models', 'mapped', 'tup'],
            properties: {
              ints: {
                type: 'array',
                items: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
              },
              models: {
                type: 'array',
                items: {
                  anyOf: [
                    { $ref: '#/components/schemas/Leaf' },
                    { type: 'null' },
                  ],
                },
              },
              mapped: {
                type: 'object',
                additionalProperties: {
                  anyOf: [{ type: 'integer' }, { type: 'null' }],
                },
              },
              tup: {
                type: 'array',
                prefixItems: [
                  {
                    anyOf: [
                      { $ref: '#/components/schemas/Leaf' },
                      { type: 'null' },
                    ],
                  },
                  { type: 'integer' },
                ],
              },
            },
          },
        },
      },
    } as unknown as Spec;

    await generateAndRead(verifier, tree, spec);
    const res = await callGeneratedClient(
      verifier,
      'get_h',
      {},
      {
        json: {
          ints: [1, null],
          models: [{ v: 1 }, null],
          mapped: { a: null },
          tup: [null, 2],
        },
      },
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({
      ints: [1, null],
      models: [{ v: 1 }, null],
      mapped: { a: null },
      tup: [null, 2],
    });
  });

  // Escaping a keyword makes `from` and `var_from` distinct in TypeScript but
  // identical in Python, so the class emitted one field twice and pydantic kept
  // only the last — binding the wire value to the wrong type.
  it('rejects two properties that collapse onto one Python name', async () => {
    tree.write(
      'openapi.json',
      JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'TestApi', version: '1.0.0' },
        paths: {
          '/c': {
            get: {
              operationId: 'getC',
              responses: {
                '200': {
                  description: 'OK',
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/Clash' },
                    },
                  },
                },
              },
            },
          },
        },
        components: {
          schemas: {
            Clash: {
              type: 'object',
              required: ['from', 'var_from'],
              properties: {
                from: { type: 'string', format: 'date' },
                var_from: { type: 'integer' },
              },
            },
          },
        },
      }),
    );
    await expect(
      openApiPyClientGenerator(tree, {
        openApiSpecPath: 'openapi.json',
        outputPath,
      }),
    ).rejects.toThrow(/both map to the Python name "var_from"/);
  });
});
