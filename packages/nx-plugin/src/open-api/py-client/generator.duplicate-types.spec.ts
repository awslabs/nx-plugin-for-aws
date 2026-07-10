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

describe('openApiPyClientGenerator - duplicate types', () => {
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

  it('should handle duplicated inline schemas across operations without clashing', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/a': {
          post: {
            operationId: 'postA',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['x'],
                    properties: { x: { type: 'string' } },
                  },
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
        '/b': {
          post: {
            operationId: 'postB',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['x'],
                    properties: { x: { type: 'string' } },
                  },
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
    };
    const { types, client } = await generateAndRead(verifier, tree, spec);
    expect(types).toMatchSnapshot('types_gen.py');
    expect(client).toMatchSnapshot('client_gen.py');

    const resA = await callGeneratedClient(
      verifier,
      'post_a',
      { x: 'hi' },
      { json: 'ok' },
    );
    expect(resA.ok).toBe(true);
    const resB = await callGeneratedClient(
      verifier,
      'post_b',
      { x: 'hi' },
      { json: 'ok' },
    );
    expect(resB.ok).toBe(true);
  });

  it('should not emit two methods with the same name when operationId matches a schema', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/thing': {
          get: {
            operationId: 'Thing',
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
            required: ['id'],
            properties: { id: { type: 'string' } },
          },
        },
      },
    };
    const { types, client } = await generateAndRead(verifier, tree, spec);
    // The Thing model is still defined and there's a method for it.
    expect(types).toContain('class Thing(BaseModel)');
    expect(client).toMatch(/def thing\(/);
  });
});
