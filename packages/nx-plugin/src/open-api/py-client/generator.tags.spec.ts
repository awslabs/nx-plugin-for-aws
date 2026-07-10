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

describe('openApiPyClientGenerator - tags', () => {
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

  it('should group operations by tag into tag namespaces', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/pet': {
          post: {
            tags: ['pet'],
            operationId: 'addPet',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Pet' },
                },
              },
            },
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Pet' },
                  },
                },
              },
            },
          },
        },
        '/store': {
          get: {
            tags: ['store'],
            operationId: 'storeStatus',
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
          Pet: {
            type: 'object',
            required: ['name'],
            properties: { name: { type: 'string' } },
          },
        },
      },
    };
    const { types, client } = await generateAndRead(verifier, tree, spec);
    expect(types).toMatchSnapshot('types_gen.py');
    expect(client).toMatchSnapshot('client_gen.py');
    expect(client).toMatch(/self\.pet:\s*_PetNamespace/);
    expect(client).toMatch(/self\.store:\s*_StoreNamespace/);
    expect(client).toContain('def add_pet(');
    expect(client).toContain('self._parent._add_pet(');

    // Call through the tag namespace.
    const res = await callGeneratedClient(
      verifier,
      'pet.add_pet',
      { name: 'doggie' },
      { json: { name: 'doggie' } },
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({ name: 'doggie' });
  });

  it('should handle operations with multiple tags', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/multi': {
          get: {
            tags: ['alpha', 'beta'],
            operationId: 'multi',
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
    const { client } = await generateAndRead(verifier, tree, spec);
    // The operation appears on both namespaces.
    expect(client).toContain('self.alpha');
    expect(client).toContain('self.beta');

    const resA = await callGeneratedClient(
      verifier,
      'alpha.multi',
      {},
      { json: 'a' },
    );
    expect(resA.ok).toBe(true);
    const resB = await callGeneratedClient(
      verifier,
      'beta.multi',
      {},
      { json: 'a' },
    );
    expect(resB.ok).toBe(true);
  });

  it('should still emit ungrouped methods when an operation has no tags', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/tagged': {
          get: {
            tags: ['group'],
            operationId: 'tagged',
            responses: {
              '200': {
                description: 'OK',
                content: { 'application/json': { schema: { type: 'string' } } },
              },
            },
          },
        },
        '/untagged': {
          get: {
            operationId: 'untagged',
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
    const { client } = await generateAndRead(verifier, tree, spec);
    // Untagged stays on the top level as a public `def untagged`.
    expect(client).toMatch(/\n {4}def untagged\(/);

    const resUntagged = await callGeneratedClient(
      verifier,
      'untagged',
      {},
      { json: 'ok' },
    );
    expect(resUntagged.ok).toBe(true);
    const resTagged = await callGeneratedClient(
      verifier,
      'group.tagged',
      {},
      { json: 'ok' },
    );
    expect(resTagged.ok).toBe(true);
  });
});
