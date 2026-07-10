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

  it('parses a Union-aliased response body via TypeAdapter at runtime', async () => {
    // Regression: `Foo = Union["Dog", "Cat"]` rendered as a module-level
    // alias failed when the generated client did
    // `Foo.model_validate(...)` — Union aliases don't have `model_validate`.
    // It also failed when aliases were emitted *before* the classes they
    // reference — TypeAdapter(Union["Dog", "Cat"]) can't resolve string
    // forward-refs at runtime (unlike pydantic class-body annotations).
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/animal': {
          post: {
            operationId: 'animalEcho',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Animal' },
                },
              },
            },
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Animal' },
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
            oneOf: [
              { $ref: '#/components/schemas/Dog' },
              { $ref: '#/components/schemas/Cat' },
            ],
          },
          Dog: {
            type: 'object',
            required: ['breed'],
            properties: {
              kind: { type: 'string', enum: ['dog'] },
              breed: { type: 'string' },
            },
          },
          Cat: {
            type: 'object',
            required: ['lives_remaining'],
            properties: {
              kind: { type: 'string', enum: ['cat'] },
              lives_remaining: { type: 'integer' },
            },
          },
        },
      },
    };
    const { types, client } = await generateAndRead(verifier, tree, spec);

    // Union alias references real class names (not "Dog" / "Cat" strings).
    expect(types).toMatch(/^Animal\s*=\s*Union\[Dog,\s*Cat\]/m);
    // Classes must appear before the alias that references them.
    const dogIdx = types.indexOf('class Dog(');
    const catIdx = types.indexOf('class Cat(');
    const aliasIdx = types.indexOf('Animal = Union[');
    expect(dogIdx).toBeGreaterThan(-1);
    expect(catIdx).toBeGreaterThan(-1);
    expect(aliasIdx).toBeGreaterThan(dogIdx);
    expect(aliasIdx).toBeGreaterThan(catIdx);

    // Client uses TypeAdapter, not `.model_validate`.
    expect(client).toContain(
      'TypeAdapter(types_gen.Animal).validate_python(response.json())',
    );
    expect(client).not.toMatch(/types_gen\.Animal\.model_validate\(/);

    // Single-Union body ops take body positionally.
    const res = await callGeneratedClient(
      verifier,
      'animal_echo',
      {},
      { json: { kind: 'dog', breed: 'labrador' } },
      [{ kind: 'dog', breed: 'labrador' }],
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({ kind: 'dog', breed: 'labrador' });
  });

  it('parses a Literal-aliased response via TypeAdapter', async () => {
    // Regression: `Foo = Literal["v1"]` aliases don't have `model_validate`.
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/version': {
          get: {
            operationId: 'version',
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Version' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Version: { type: 'string', enum: ['v1'] },
        },
      },
    };
    const { client } = await generateAndRead(verifier, tree, spec);
    expect(client).toContain(
      'TypeAdapter(types_gen.Version).validate_python(response.json())',
    );
    expect(client).not.toMatch(/types_gen\.Version\.model_validate\(/);

    const res = await callGeneratedClient(
      verifier,
      'version',
      {},
      {
        json: 'v1',
      },
    );
    expect(res.ok).toBe(true);
    expect(res.value).toBe('v1');
  });
});
