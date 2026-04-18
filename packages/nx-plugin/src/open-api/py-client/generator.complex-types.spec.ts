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

describe('openApiPyClientGenerator - complex types', () => {
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
    expect(types).toMatchSnapshot('types_gen.py');

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
    expect(types).toMatchSnapshot('types_gen.py');

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
    expect(types).toMatchSnapshot('types_gen.py');

    const res = await callGeneratedClient(
      verifier,
      'maps',
      {},
      { json: { byId: { '1': { name: 'a' }, '2': { name: 'b' } } } },
    );
    expect(res.ok).toBe(true);
  });
});
