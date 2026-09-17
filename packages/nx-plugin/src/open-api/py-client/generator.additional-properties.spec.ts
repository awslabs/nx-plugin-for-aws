/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import type { Spec } from '../utils/types.js';
import {
  callGeneratedClient,
  createPythonClientVerifier,
  createTree,
  generateAndRead,
} from './generator.utils.spec.js';

describe('openApiPyClientGenerator - additional properties', () => {
  let tree: Tree;
  const verifier = createPythonClientVerifier();

  beforeEach(() => {
    tree = createTree();
  });

  it('should emit dict[str, T] for plain additionalProperties objects', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/counts': {
          get: {
            operationId: 'counts',
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
    const { types } = await generateAndRead(verifier, tree, spec);
    expect(types).toMatchSnapshot('types.py');

    const res = await callGeneratedClient(
      verifier,
      'counts',
      {},
      { json: { a: 1, b: 2 } },
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({ a: 1, b: 2 });
  });

  it('should handle object models with a mixture of properties and additionalProperties', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/mixed': {
          get: {
            operationId: 'mixed',
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Mixed' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Mixed: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'string' },
            },
            additionalProperties: { type: 'integer' },
          },
        },
      },
    };
    const { types } = await generateAndRead(verifier, tree, spec);
    expect(types).toMatchSnapshot('types.py');

    // pydantic accepts unknown properties because of extra="allow".
    const res = await callGeneratedClient(
      verifier,
      'mixed',
      {},
      { json: { id: 'abc', extra: 99 } },
    );
    expect(res.ok).toBe(true);
    expect(res.value).toMatchObject({ id: 'abc', extra: 99 });
  });
});
