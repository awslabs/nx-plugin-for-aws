/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
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
      (result.paths?.['/test'].post.requestBody as any).content[
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
      (result.paths?.['/test'].get.responses['200'] as any).content[
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
    expect((result.components?.schemas?.TestArray as any).items).toEqual({
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
      (result.components?.schemas?.TestMap as any).additionalProperties,
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
      (result.components?.schemas?.TestObject as any).properties.field,
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
      (result.components?.schemas?.TestObject as any).properties.ref,
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
      (result.components?.schemas?.TestObject as any).properties.status,
    ).toEqual({
      $ref: '#/components/schemas/Status',
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
    expect((result.components?.schemas?.TestComposite as any).allOf).toEqual([
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
    expect((result.components?.schemas?.TestNot as any).not).toEqual({
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
      (result.components?.schemas?.TestObject as any).properties.status,
    ).toEqual({
      $ref: '#/components/schemas/TestObjectStatus',
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
    expect((result.components?.schemas?.TestArray as any).items).toEqual({
      $ref: '#/components/schemas/CustomTitle',
    });
  });
});
