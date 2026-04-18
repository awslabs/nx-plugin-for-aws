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

describe('openApiPyClientGenerator - reserved keywords', () => {
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

  it('should rename python reserved keywords in property names with alias', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/r': {
          post: {
            operationId: 'r',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/R' },
                },
              },
            },
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/R' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          R: {
            type: 'object',
            required: ['class'],
            properties: { class: { type: 'string' } },
          },
        },
      },
    };
    const { types, client } = await generateAndRead(verifier, tree, spec);
    expect(types).toMatchSnapshot('types_gen.py');
    expect(client).toMatchSnapshot('client_gen.py');
    expect(types).toContain('alias="class"');

    const res = await callGeneratedClient(
      verifier,
      'r',
      { var_class: 'vip' },
      { json: { class: 'vip' } },
    );
    expect(res.ok).toBe(true);
    // Pydantic round-trips using the wire-name alias.
    expect(res.value).toEqual({ class: 'vip' });
  });

  it('should rename python reserved keywords in operation IDs', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/class': {
          get: {
            operationId: 'class',
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
    // "class" is a reserved keyword — the method is renamed.
    expect(client).not.toMatch(/def class\(/);
    // The expected rename is `call_class` via `toPythonName('operation', 'class')`.
    expect(client).toMatch(/def call_class\(/);
  });

  it('should rename properties whose name clashes with typing/pydantic utilities (e.g. schema)', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/s': {
          post: {
            operationId: 's',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/S' },
                },
              },
            },
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/S' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          S: {
            type: 'object',
            required: ['schema'],
            properties: { schema: { type: 'string' } },
          },
        },
      },
    };
    const { types } = await generateAndRead(verifier, tree, spec);
    // `schema` is renamed by our PYTHON_KEYWORDS list to `var_schema`.
    expect(types).toContain('var_schema:');
    expect(types).toContain('alias="schema"');
  });
});
