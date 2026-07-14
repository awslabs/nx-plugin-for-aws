/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { normaliseOpenApiSpecForCodeGen } from './normalise';
import type { Spec } from './types';

describe('normaliseOpenApiSpecForCodeGen', () => {
  it('should initialize empty components and schemas if not present', () => {
    const spec: Spec = {} as any;
    const result = normaliseOpenApiSpecForCodeGen(spec);
    expect(result.components?.schemas).toEqual({});
  });

  it('should hoist inline request body schemas', () => {
    const spec: Spec = {
      paths: {
        '/test': {
          post: {
            operationId: 'testPost',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: { schemas: {} },
    } as any;

    const result = normaliseOpenApiSpecForCodeGen(spec);

    expect(
      (result.paths!['/test'].post.requestBody as any).content[
        'application/json'
      ].schema,
    ).toEqual({
      $ref: '#/components/schemas/TestPostRequestContent',
    });
    expect(result.components?.schemas?.TestPostRequestContent).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    });
  });

  it('should hoist inline response schemas', () => {
    const spec: Spec = {
      paths: {
        '/test': {
          get: {
            operationId: 'testGet',
            responses: {
              '200': {
                description: 'test',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        result: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: { schemas: {} },
    } as any;

    const result = normaliseOpenApiSpecForCodeGen(spec);

    expect(
      (result.paths!['/test'].get.responses['200'] as any).content[
        'application/json'
      ].schema,
    ).toEqual({
      $ref: '#/components/schemas/TestGet200Response',
    });
    expect(result.components?.schemas?.TestGet200Response).toEqual({
      type: 'object',
      properties: {
        result: { type: 'string' },
      },
    });
  });

  it('should hoist nested object definitions in arrays', () => {
    const spec: Spec = {
      components: {
        schemas: {
          TestArray: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
              },
            },
          },
        },
      },
    } as any;

    const result = normaliseOpenApiSpecForCodeGen(spec);

    expect(result.components?.schemas?.TestArrayItem).toBeDefined();
    expect((result.components!.schemas!.TestArray as any).items).toEqual({
      $ref: '#/components/schemas/TestArrayItem',
    });
  });

  it('should hoist nested object definitions in maps', () => {
    const spec: Spec = {
      components: {
        schemas: {
          TestMap: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              properties: {
                value: { type: 'string' },
              },
            },
          },
        },
      },
    } as any;

    const result = normaliseOpenApiSpecForCodeGen(spec);

    expect(result.components?.schemas?.TestMapValue).toBeDefined();
    expect(
      (result.components!.schemas!.TestMap as any).additionalProperties,
    ).toEqual({
      $ref: '#/components/schemas/TestMapValue',
    });
  });

  it('should inline refs to primitive types', () => {
    const spec: Spec = {
      components: {
        schemas: {
          StringType: {
            type: 'string',
          },
          TestObject: {
            type: 'object',
            properties: {
              field: {
                $ref: '#/components/schemas/StringType',
              },
            },
          },
        },
      },
    } as any;

    const result = normaliseOpenApiSpecForCodeGen(spec);

    expect(result.components?.schemas?.StringType).toBeUndefined();
    expect(
      (result.components!.schemas!.TestObject as any).properties.field,
    ).toEqual({
      type: 'string',
    });
  });

  it('should not inline refs to object types', () => {
    const spec: Spec = {
      components: {
        schemas: {
          ReferencedObject: {
            type: 'object',
            properties: {
              field: { type: 'string' },
            },
          },
          TestObject: {
            type: 'object',
            properties: {
              ref: {
                $ref: '#/components/schemas/ReferencedObject',
              },
            },
          },
        },
      },
    } as any;

    const result = normaliseOpenApiSpecForCodeGen(spec);

    expect(result.components?.schemas?.ReferencedObject).toBeDefined();
    expect(
      (result.components!.schemas!.TestObject as any).properties.ref,
    ).toEqual({
      $ref: '#/components/schemas/ReferencedObject',
    });
  });

  it('should not inline refs to enum types', () => {
    const spec: Spec = {
      components: {
        schemas: {
          Status: {
            type: 'string',
            enum: ['active', 'inactive'],
          },
          TestObject: {
            type: 'object',
            properties: {
              status: {
                $ref: '#/components/schemas/Status',
              },
            },
          },
        },
      },
    } as any;

    const result = normaliseOpenApiSpecForCodeGen(spec);

    expect(result.components?.schemas?.Status).toBeDefined();
    expect(
      (result.components!.schemas!.TestObject as any).properties.status,
    ).toEqual({
      $ref: '#/components/schemas/Status',
    });
  });

  it('should throw when a normalised schema name clashes with an existing schema', () => {
    const spec: Spec = {
      components: {
        schemas: {
          'Foo-Bar': { type: 'object', properties: { a: { type: 'string' } } },
          FooBar: { type: 'object', properties: { b: { type: 'number' } } },
        },
      },
    } as any;

    expect(() => normaliseOpenApiSpecForCodeGen(spec)).toThrow(
      /would be normalized to "FooBar", but a schema with that name already exists/,
    );
  });

  it('should throw when two schemas normalise to the same name', () => {
    const spec: Spec = {
      components: {
        schemas: {
          'Foo-Bar': { type: 'object', properties: { a: { type: 'string' } } },
          'Foo.Bar': { type: 'object', properties: { b: { type: 'number' } } },
        },
      },
    } as any;

    expect(() => normaliseOpenApiSpecForCodeGen(spec)).toThrow(
      /both normalize to "FooBar"/,
    );
  });

  it('should record the original name when normalising a schema name', () => {
    const spec: Spec = {
      components: {
        schemas: {
          'pet-cat': { type: 'object', properties: { a: { type: 'string' } } },
        },
      },
    } as any;

    const result = normaliseOpenApiSpecForCodeGen(spec);

    expect(result.components?.schemas?.['pet-cat']).toBeUndefined();
    expect(result.components?.schemas?.PetCat).toMatchObject({
      type: 'object',
      'x-aws-nx-original-name': 'pet-cat',
    });
  });

  it('should handle composite schemas', () => {
    const spec: Spec = {
      components: {
        schemas: {
          TestComposite: {
            allOf: [
              {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                },
              },
              {
                type: 'object',
                properties: {
                  age: { type: 'number' },
                },
              },
            ],
          },
        },
      },
    } as any;

    const result = normaliseOpenApiSpecForCodeGen(spec);

    expect(result.components?.schemas?.TestCompositeAllOf).toBeDefined();
    expect(result.components?.schemas?.TestCompositeAllOf1).toBeDefined();
    expect((result.components!.schemas!.TestComposite as any).allOf).toEqual([
      { $ref: '#/components/schemas/TestCompositeAllOf' },
      { $ref: '#/components/schemas/TestCompositeAllOf1' },
    ]);
  });

  it('should handle not schemas', () => {
    const spec: Spec = {
      components: {
        schemas: {
          TestNot: {
            not: {
              type: 'object',
              properties: {
                forbidden: { type: 'string' },
              },
            },
          },
        },
      },
    } as any;

    const result = normaliseOpenApiSpecForCodeGen(spec);

    expect(result.components?.schemas?.TestNotNot).toBeDefined();
    expect((result.components!.schemas!.TestNot as any).not).toEqual({
      $ref: '#/components/schemas/TestNotNot',
    });
  });

  it('should hoist inline enum definitions', () => {
    const spec: Spec = {
      components: {
        schemas: {
          TestObject: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                enum: ['pending', 'active', 'completed'],
              },
            },
          },
        },
      },
    } as any;

    const result = normaliseOpenApiSpecForCodeGen(spec);

    expect(result.components?.schemas?.TestObjectStatus).toBeDefined();
    expect(result.components?.schemas?.TestObjectStatus).toEqual({
      type: 'string',
      enum: ['pending', 'active', 'completed'],
      'x-aws-nx-hoisted': true,
    });
    expect(
      (result.components!.schemas!.TestObject as any).properties.status,
    ).toEqual({
      $ref: '#/components/schemas/TestObjectStatus',
    });
  });

  it('should hoist an inline object parameter schema to a named model', () => {
    const spec: Spec = {
      paths: {
        '/search': {
          get: {
            operationId: 'search',
            parameters: [
              {
                name: 'filter',
                in: 'query',
                style: 'deepObject',
                schema: {
                  type: 'object',
                  properties: { name: { type: 'string' } },
                },
              },
            ],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
      components: { schemas: {} },
    } as any;

    const result = normaliseOpenApiSpecForCodeGen(spec);

    expect((result.paths!['/search'] as any).get.parameters[0].schema).toEqual({
      $ref: '#/components/schemas/SearchRequestQueryFilter',
    });
    expect(result.components?.schemas?.SearchRequestQueryFilter).toMatchObject({
      type: 'object',
      properties: { name: { type: 'string' } },
    });
  });

  it('should not hoist a primitive parameter schema', () => {
    const spec: Spec = {
      paths: {
        '/search': {
          get: {
            operationId: 'search',
            parameters: [
              { name: 'q', in: 'query', schema: { type: 'string' } },
            ],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
      components: { schemas: {} },
    } as any;

    const result = normaliseOpenApiSpecForCodeGen(spec);

    expect((result.paths!['/search'] as any).get.parameters[0].schema).toEqual({
      type: 'string',
    });
    expect(result.components?.schemas?.SearchRequestQueryQ).toBeUndefined();
  });

  it('should inline $ref path items', () => {
    const spec: Spec = {
      paths: {
        '/a': { $ref: '#/components/pathItems/Shared' },
        '/b': { $ref: '#/components/pathItems/Shared' },
      },
      components: {
        pathItems: {
          Shared: {
            get: {
              responses: { '200': { description: 'ok' } },
            },
          },
        },
        schemas: {},
      },
    } as any;

    const result = normaliseOpenApiSpecForCodeGen(spec);

    expect((result.paths!['/a'] as any).get).toBeDefined();
    expect((result.paths!['/b'] as any).get).toBeDefined();
    expect((result.paths!['/a'] as any).$ref).toBeUndefined();
    // Each path gets its own copy, so each operation gets its own
    // (path-derived) operationId
    expect((result.paths!['/a'] as any).get.operationId).toBe('getA');
    expect((result.paths!['/b'] as any).get.operationId).toBe('getB');
  });

  it('should hoist inline schemas for vendored +json media types', () => {
    const spec: Spec = {
      paths: {
        '/test': {
          post: {
            operationId: 'testPost',
            requestBody: {
              content: {
                'application/vnd.api+json': {
                  schema: {
                    type: 'object',
                    properties: { name: { type: 'string' } },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/problem+json': {
                    schema: {
                      type: 'object',
                      properties: { detail: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: { schemas: {} },
    } as any;

    const result = normaliseOpenApiSpecForCodeGen(spec);

    expect(
      (result.paths!['/test'].post.requestBody as any).content[
        'application/vnd.api+json'
      ].schema,
    ).toEqual({ $ref: '#/components/schemas/TestPostRequestContent' });
    expect(
      (result.paths!['/test'].post.responses['200'] as any).content[
        'application/problem+json'
      ].schema,
    ).toEqual({ $ref: '#/components/schemas/TestPost200Response' });
  });

  it('should rewrite multi-type schemas nested inside rewritten schemas', () => {
    const spec: Spec = {
      components: {
        schemas: {
          Thing: {
            type: ['array', 'null'],
            items: { type: ['integer', 'string'] },
          },
        },
      },
    } as any;

    const result = normaliseOpenApiSpecForCodeGen(spec);

    const thing = result.components?.schemas?.Thing as any;
    expect(thing.type).toEqual('array');
    expect(thing.nullable).toBe(true);
    // The rewritten multi-type items are a composite, so they are hoisted
    expect(thing.items).toEqual({ $ref: '#/components/schemas/ThingItem' });
    expect(result.components?.schemas?.ThingItem).toMatchObject({
      anyOf: [{ type: 'integer' }, { type: 'string' }],
    });
  });

  it('should rewrite const schemas nested inside rewritten schemas', () => {
    const spec: Spec = {
      components: {
        schemas: {
          Thing: {
            type: ['object', 'null'],
            properties: {
              kind: { type: 'string', const: 'fixed' },
            },
          },
        },
      },
    } as any;

    const result = normaliseOpenApiSpecForCodeGen(spec);

    const thing = result.components?.schemas?.Thing as any;
    expect(thing.nullable).toBe(true);
    // The const property is rewritten to an enum (and hoisted as one)
    expect(result.components?.schemas?.ThingKind).toMatchObject({
      type: 'string',
      enum: ['fixed'],
    });
  });

  it('should preserve schema titles when hoisting', () => {
    const spec: Spec = {
      components: {
        schemas: {
          TestArray: {
            type: 'array',
            items: {
              title: 'CustomTitle',
              type: 'object',
              properties: {
                id: { type: 'string' },
              },
            },
          },
        },
      },
    } as any;

    const result = normaliseOpenApiSpecForCodeGen(spec);

    expect(result.components?.schemas?.CustomTitle).toBeDefined();
    expect((result.components!.schemas!.TestArray as any).items).toEqual({
      $ref: '#/components/schemas/CustomTitle',
    });
  });
});
