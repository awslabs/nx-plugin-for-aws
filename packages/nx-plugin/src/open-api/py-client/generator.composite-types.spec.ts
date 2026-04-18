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

describe('openApiPyClientGenerator - composite types', () => {
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

  it('should emit Union types for anyOf', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/u': {
          post: {
            operationId: 'u',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Wrap' },
                },
              },
            },
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Wrap' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Wrap: {
            type: 'object',
            required: ['value'],
            properties: {
              value: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
            },
          },
        },
      },
    };
    const { types } = await generateAndRead(verifier, tree, spec);
    expect(types).toMatchSnapshot('types_gen.py');
    expect(types).toMatch(/Union\[.*str.*int.*\]|str \| int/);

    const res = await callGeneratedClient(
      verifier,
      'u',
      { value: 7 },
      { json: { value: 7 } },
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({ value: 7 });
  });

  it('should emit Union types for oneOf', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/o': {
          post: {
            operationId: 'o',
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Wrap' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Wrap: {
            type: 'object',
            required: ['value'],
            properties: {
              value: { oneOf: [{ type: 'string' }, { type: 'boolean' }] },
            },
          },
        },
      },
    };
    const { types } = await generateAndRead(verifier, tree, spec);
    expect(types).toMatchSnapshot('types_gen.py');
  });

  it('should flatten allOf inheritance into a single pydantic class', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/dog': {
          post: {
            operationId: 'dog',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Dog' },
                },
              },
            },
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Dog' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Animal: {
            type: 'object',
            required: ['name'],
            properties: { name: { type: 'string' } },
          },
          Dog: {
            allOf: [
              { $ref: '#/components/schemas/Animal' },
              {
                type: 'object',
                required: ['breed'],
                properties: { breed: { type: 'string' } },
              },
            ],
          },
        },
      },
    };
    const { types, client } = await generateAndRead(verifier, tree, spec);
    expect(types).toMatchSnapshot('types_gen.py');
    expect(client).toMatchSnapshot('client_gen.py');
    // Fields from both composed models end up on the Dog class.
    expect(types).toMatch(/class Dog\(BaseModel\)/);
    expect(types).toMatch(/name:\s*str/);
    expect(types).toMatch(/breed:\s*str/);

    const res = await callGeneratedClient(
      verifier,
      'dog',
      { name: 'rex', breed: 'labrador' },
      { json: { name: 'rex', breed: 'labrador' } },
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({ name: 'rex', breed: 'labrador' });
  });

  it('should handle recursive schema references', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/tree': {
          post: {
            operationId: 'tree',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Tree' },
                },
              },
            },
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Tree' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Tree: {
            type: 'object',
            required: ['value'],
            properties: {
              value: { type: 'integer' },
              children: {
                type: 'array',
                items: { $ref: '#/components/schemas/Tree' },
              },
            },
          },
        },
      },
    };
    const { types } = await generateAndRead(verifier, tree, spec);
    expect(types).toMatchSnapshot('types_gen.py');

    const payload = {
      value: 1,
      children: [
        { value: 2, children: [] },
        { value: 3, children: [] },
      ],
    };
    const res = await callGeneratedClient(verifier, 'tree', payload, {
      json: payload,
    });
    expect(res.ok).toBe(true);
    expect(res.value).toEqual(payload);
  });
});
