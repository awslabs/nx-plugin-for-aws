/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Tree } from '@nx/devkit';
import { importTypeScriptModule } from '../../utils/js';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { expectTypeScriptToCompile } from '../../utils/test/ts.spec';
import type { Spec } from '../utils/types';
import { openApiTsClientGenerator } from './generator';
import { baseUrl, callGeneratedClient } from './generator.utils.spec';

describe('openApiTsClientGenerator - composite schemas', () => {
  let tree: Tree;
  const title = 'TestApi';

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const validateTypeScript = (paths: string[]) => {
    expectTypeScriptToCompile(tree, paths);
  };

  it('should generate valid TypeScript for composite types', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/test': {
          put: {
            operationId: 'putTest',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      {
                        type: 'object',
                        properties: {
                          type: { type: 'string', enum: ['a'] },
                          valueA: { type: 'string' },
                        },
                        required: ['type', 'valueA'],
                      },
                      {
                        type: 'object',
                        properties: {
                          type: { type: 'string', enum: ['b'] },
                          valueB: { type: 'number' },
                        },
                        required: ['type', 'valueB'],
                      },
                    ],
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'test',
                content: {
                  'application/json': {
                    schema: {
                      allOf: [
                        {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                          },
                          required: ['id'],
                        },
                        {
                          type: 'object',
                          properties: {
                            metadata: {
                              type: 'object',
                              properties: {
                                created: {
                                  type: 'string',
                                  format: 'date-time',
                                },
                              },
                            },
                          },
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
    ]);

    const types = tree.read('src/generated/types.gen.ts', 'utf-8');
    expect(types).toMatchSnapshot();

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    expect(client).toMatchSnapshot();

    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        id: 'test123',
        metadata: {
          created: '2024-02-20T12:00:00.000Z',
        },
      }),
    });

    // Test type 'a' request
    const requestA = {
      type: 'a' as const,
      valueA: 'test value',
    };
    const responseA = await callGeneratedClient(
      client,
      mockFetch,
      'putTest',
      requestA,
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/test`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(requestA),
      }),
    );
    expect(responseA).toEqual({
      id: 'test123',
      metadata: {
        created: new Date('2024-02-20T12:00:00Z'),
      },
    });

    // Test type 'b' request
    mockFetch.mockClear();
    const requestB = {
      type: 'b' as const,
      valueB: 42,
    };
    const responseB = await callGeneratedClient(
      client,
      mockFetch,
      'putTest',
      requestB,
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/test`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(requestB),
      }),
    );
    expect(responseB).toEqual({
      id: 'test123',
      metadata: {
        created: new Date('2024-02-20T12:00:00Z'),
      },
    });
  });

  it('should handle inline primitives and composite schemas', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/primitives/text': {
          post: {
            operationId: 'testPrimitiveText',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { type: 'string' },
                },
              },
            },
            responses: {
              '200': {
                description: 'test',
                content: {
                  'application/json': {
                    schema: { type: 'number' },
                  },
                },
              },
            },
          },
        },
        '/primitives/binary': {
          post: {
            operationId: 'testPrimitiveBinary',
            requestBody: {
              required: true,
              content: {
                'application/octet-stream': {
                  schema: { type: 'string', format: 'binary' },
                },
              },
            },
            responses: {
              '200': {
                description: 'test',
                content: {
                  'application/json': {
                    schema: { type: 'string', format: 'binary' },
                  },
                },
              },
            },
          },
        },
        '/arrays': {
          post: {
            operationId: 'testArrays',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'test',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      additionalProperties: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
        },
        '/arrays-with-other-parameters': {
          post: {
            operationId: 'testArraysWithOtherParameters',
            parameters: [
              {
                name: 'someParameter',
                in: 'query',
                schema: {
                  type: 'string',
                },
              },
            ],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'test',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      additionalProperties: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
        },
        '/composites': {
          post: {
            operationId: 'testComposites',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      { type: 'string', enum: ['a', 'b', 'c'] },
                      { type: 'string', maxLength: 1 },
                    ],
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'test',
                content: {
                  'application/json': {
                    schema: {
                      anyOf: [
                        {
                          type: 'object',
                          properties: { foo: { type: 'string' } },
                        },
                        {
                          type: 'object',
                          properties: { bar: { type: 'string' } },
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
        '/enums': {
          get: {
            operationId: 'testEnums',
            responses: {
              '200': {
                description: 'test',
                content: {
                  'application/json': {
                    schema: {
                      type: 'string',
                      enum: ['pending', 'active', 'completed'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
    ]);

    const types = tree.read('src/generated/types.gen.ts', 'utf-8');
    expect(types).toMatchSnapshot();

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    expect(client).toMatchSnapshot();

    const mockFetch = vi.fn();

    // Test primitive text endpoint
    mockFetch.mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue(42),
    });

    expect(
      await callGeneratedClient(
        client,
        mockFetch,
        'testPrimitiveText',
        'hello',
      ),
    ).toBe(42);
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/primitives/text`,
      expect.objectContaining({
        method: 'POST',
        body: 'hello',
      }),
    );

    // Test binary endpoint
    mockFetch.mockClear();
    const binaryData = new Blob([new Uint8Array([1, 2, 3])]);
    mockFetch.mockResolvedValue({
      status: 200,
      blob: vi.fn().mockResolvedValue(binaryData),
    });

    expect(
      await callGeneratedClient(
        client,
        mockFetch,
        'testPrimitiveBinary',
        binaryData,
      ),
    ).toBeInstanceOf(Blob);
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/primitives/binary`,
      expect.objectContaining({
        method: 'POST',
        body: binaryData,
      }),
    );

    // Test arrays endpoint
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({ key1: 1, key2: 2 }),
    });

    const arrayData = ['test1', 'test2'];
    expect(
      await callGeneratedClient(client, mockFetch, 'testArrays', arrayData),
    ).toEqual({ key1: 1, key2: 2 });
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/arrays`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(arrayData),
      }),
    );

    // Test arrays with query parameters
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({ 'key-1': 1, key2: 2 }),
    });

    expect(
      await callGeneratedClient(
        client,
        mockFetch,
        'testArraysWithOtherParameters',
        { body: arrayData, someParameter: 'value' },
      ),
    ).toEqual({ 'key-1': 1, key2: 2 });
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/arrays-with-other-parameters?someParameter=value`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(arrayData),
      }),
    );

    // Test composites endpoint
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({ foo: 'foo' }),
    });

    expect(
      await callGeneratedClient(client, mockFetch, 'testComposites', 'a'),
    ).toEqual({ foo: 'foo' });
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/composites`,
      expect.objectContaining({
        method: 'POST',
        body: 'a',
      }),
    );

    // Test enums endpoint
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue('active'),
    });

    expect(await callGeneratedClient(client, mockFetch, 'testEnums')).toBe(
      'active',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/enums`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('should throw for primitive composite responses', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/composite-bad': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      { type: 'string', enum: ['a', 'b', 'c'] },
                      { type: 'string', maxLength: 1 },
                    ],
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'test',
                content: {
                  'application/json': {
                    schema: {
                      anyOf: [
                        { type: 'string', enum: ['a', 'b', 'c'] },
                        { type: 'number' },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await expect(
      openApiTsClientGenerator(tree, {
        openApiSpecPath: 'openapi.json',
        outputPath: 'src/generated',
      }),
    ).rejects.toThrow(
      /returns a composite schema of primitives with anyOf, which cannot be distinguished at runtime/,
    );
  });

  it('should handle composite primitive and array request bodies', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/composite': {
          post: {
            operationId: 'composite',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      {
                        type: 'string',
                        nullable: true,
                      },
                      {
                        type: 'number',
                        nullable: true,
                      },
                      {
                        type: 'boolean',
                        nullable: true,
                      },
                      {
                        type: 'array',
                        items: { type: 'string' },
                        nullable: true,
                      },
                      {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: { a: { type: 'string' } },
                        },
                        nullable: true,
                      },
                      {
                        type: 'object',
                        additionalProperties: {
                          type: 'number',
                        },
                        nullable: true,
                      },
                      {
                        type: 'object',
                        additionalProperties: {
                          type: 'object',
                          properties: { a: { type: 'string' } },
                        },
                        nullable: true,
                      },
                      {
                        type: 'object',
                        properties: {
                          key: { type: 'string' },
                        },
                        nullable: true,
                      },
                    ],
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Success',
                content: {
                  'application/json': {
                    schema: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
    ]);

    const types = tree.read('src/generated/types.gen.ts', 'utf-8');
    expect(types).toMatchSnapshot();

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    expect(client).toMatchSnapshot();

    const mockFetch = vi.fn();

    // Test string input
    mockFetch.mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue('response'),
    });
    expect(
      await callGeneratedClient(client, mockFetch, 'composite', 'test'),
    ).toEqual('response');
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/composite`,
      expect.objectContaining({
        method: 'POST',
        body: 'test',
      }),
    );

    // Test number input
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue('response'),
    });
    expect(
      await callGeneratedClient(client, mockFetch, 'composite', 123),
    ).toEqual('response');
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/composite`,
      expect.objectContaining({
        method: 'POST',
        body: '123',
      }),
    );

    // Test boolean input
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue('response'),
    });
    expect(
      await callGeneratedClient(client, mockFetch, 'composite', true),
    ).toEqual('response');
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/composite`,
      expect.objectContaining({
        method: 'POST',
        body: 'true',
      }),
    );

    // Test string array input
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue('response'),
    });
    expect(
      await callGeneratedClient(client, mockFetch, 'composite', ['test']),
    ).toEqual('response');
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/composite`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(['test']),
      }),
    );

    // Test object array input
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue('response'),
    });
    expect(
      await callGeneratedClient(client, mockFetch, 'composite', [
        { a: 'test' },
      ]),
    ).toEqual('response');
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/composite`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify([{ a: 'test' }]),
      }),
    );

    // Test record of numbers input
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue('response'),
    });
    expect(
      await callGeneratedClient(client, mockFetch, 'composite', { key: 123 }),
    ).toEqual('response');
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/composite`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ key: 123 }),
      }),
    );

    // Test record of objects input
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue('response'),
    });
    expect(
      await callGeneratedClient(client, mockFetch, 'composite', {
        key: { a: 'test' },
      }),
    ).toEqual('response');
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/composite`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ key: { a: 'test' } }),
      }),
    );

    // Test object input
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue('response'),
    });
    expect(
      await callGeneratedClient(client, mockFetch, 'composite', {
        key: 'test',
      }),
    ).toEqual('response');
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/composite`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ key: 'test' }),
      }),
    );

    // Test null input
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue('response'),
    });
    expect(
      await callGeneratedClient(client, mockFetch, 'composite', null),
    ).toEqual('response');
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/composite`,
      expect.objectContaining({
        method: 'POST',
        body: 'null',
      }),
    );
  });

  it('should handle not schema type', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/not': {
          post: {
            operationId: 'testNot',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      notObject: {
                        not: {
                          type: 'object',
                          properties: {
                            foo: { type: 'string' },
                          },
                        },
                      },
                      notString: {
                        not: {
                          type: 'string',
                        },
                      },
                    },
                  },
                },
              },
            },
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
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
    ]);

    const types = tree.read('src/generated/types.gen.ts', 'utf-8');
    expect(types).toMatchSnapshot();

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    expect(client).toMatchSnapshot();
  });

  it('should throw error for composite schema with multiple object array schemas', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/test': {
          post: {
            operationId: 'postTest',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            type: { type: 'string', enum: ['a'] },
                            value: { type: 'string' },
                          },
                          required: ['type', 'value'],
                        },
                      },
                      {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            type: { type: 'string', enum: ['b'] },
                            count: { type: 'number' },
                          },
                          required: ['type', 'count'],
                        },
                      },
                    ],
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Success',
                content: {
                  'application/json': {
                    schema: {
                      type: 'string',
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await expect(
      openApiTsClientGenerator(tree, {
        openApiSpecPath: 'openapi.json',
        outputPath: 'src/generated',
      }),
    ).rejects.toThrow(
      /multiple array types which cannot be distinguished at runtime/,
    );
  });

  it('should handle anyOf with any type', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/anyOfAny': {
          post: {
            operationId: 'testAnyOfAny',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      anyType: {
                        anyOf: [
                          {},
                          {
                            type: 'null' as any,
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
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
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
    ]);

    const types = tree.read('src/generated/types.gen.ts', 'utf-8');
    expect(types).toMatchSnapshot();

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    expect(client).toMatchSnapshot();
  });

  it('should handle anyOf with enums', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/anyOfEnum': {
          post: {
            operationId: 'testAnyOfEnum',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      anyType: {
                        anyOf: [
                          {
                            type: 'string',
                            enum: ['a', 'b', 'c'],
                          },
                          {
                            type: 'null' as any,
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
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
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
    ]);

    const types = tree.read('src/generated/types.gen.ts', 'utf-8');
    expect(types).toMatchSnapshot();

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    expect(client).toMatchSnapshot();
  });

  it('should round-trip Date through a composite alias using instanceof checks', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      components: {
        schemas: {
          MaybeDate: {
            oneOf: [
              { type: 'string', format: 'date-time' },
              {
                type: 'object',
                properties: { marker: { type: 'string' } },
                required: ['marker'],
              },
            ],
          },
        },
      },
      paths: {
        '/maybe-date': {
          post: {
            operationId: 'postMaybeDate',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/MaybeDate' },
                },
              },
            },
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
    ]);

    const client = tree.read('src/generated/client.gen.ts', 'utf-8')!;
    const types = tree.read('src/generated/types.gen.ts', 'utf-8')!;

    // The composite's toJson/fromJson must use instanceof Date rather than
    // the unreachable typeof === "Date" check.
    expect(client).toContain('model instanceof Date');
    expect(client).toContain('json instanceof Date');
    expect(client).not.toMatch(/typeof\s+model\s*===\s*["']Date["']/);
    expect(client).not.toMatch(/typeof\s+json\s*===\s*["']Date["']/);

    expect(types).toMatchSnapshot();
    expect(client).toMatchSnapshot();

    // Round-trip a Date through the composite's toJson / fromJson.
    const { $IO } = await importTypeScriptModule<any>(client);

    const isoString = '2024-02-20T12:00:00.000Z';
    const date = new Date(isoString);

    // Date branch should serialise to its ISO string.
    expect($IO.MaybeDate.toJson(date)).toBe(isoString);
    // Date branch should deserialise back to an equivalent Date.
    const fromJsonDate = $IO.MaybeDate.fromJson(isoString);
    expect(fromJsonDate).toBeInstanceOf(Date);
    expect((fromJsonDate as Date).toISOString()).toBe(isoString);

    // Object branch should round-trip untouched.
    const obj = { marker: 'hello' };
    expect($IO.MaybeDate.toJson(obj)).toEqual(obj);
    expect($IO.MaybeDate.fromJson({ marker: 'hello' })).toEqual(obj);

    // Exercise the full client request path (serialisation).
    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue('ok'),
    });

    await callGeneratedClient(client, mockFetch, 'postMaybeDate', date);
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/maybe-date`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(isoString),
      }),
    );
  });

  it('should handle FastAPI-style discriminated unions with string const (Literal)', async () => {
    const spec: Spec = {
      openapi: '3.1.0',
      info: { title, version: '1.0.0' },
      components: {
        schemas: {
          Circle: {
            type: 'object',
            properties: {
              kind: { type: 'string', const: 'circle', title: 'Kind' },
              radius: { type: 'number' },
            },
            required: ['kind', 'radius'],
          },
          Square: {
            type: 'object',
            properties: {
              kind: { type: 'string', const: 'square', title: 'Kind' },
              side: { type: 'number' },
            },
            required: ['kind', 'side'],
          },
          ShapesOut: {
            type: 'object',
            properties: {
              canonical: {
                oneOf: [
                  { $ref: '#/components/schemas/Circle' },
                  { $ref: '#/components/schemas/Square' },
                ],
                discriminator: {
                  propertyName: 'kind',
                  mapping: {
                    circle: '#/components/schemas/Circle',
                    square: '#/components/schemas/Square',
                  },
                },
              },
            },
            required: ['canonical'],
          },
        } as any,
      },
      paths: {
        '/shapes': {
          get: {
            operationId: 'getShapes',
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/ShapesOut' },
                  },
                },
              },
            },
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    // Must compile cleanly — the phantom _String references break strict tsc.
    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
    ]);

    const types = tree.read('src/generated/types.gen.ts', 'utf-8')!;
    const client = tree.read('src/generated/client.gen.ts', 'utf-8')!;

    // Phantom references synthesised from `const` must not leak through.
    // Previously the const shape caused hey-api-openapi to reference a
    // non-existent `_String` type, breaking tsc in strict mode.
    expect(types).not.toMatch(/\b_String\b/);
    expect(client).not.toMatch(/\b_String\b/);
    expect(types).not.toMatch(/:\s*undefined\b/);

    // The discriminator property is typed as its literal per subtype, making
    // the union a true tagged union that narrows on `kind`.
    expect(types).toMatch(/kind:\s*'circle'/);
    expect(types).toMatch(/kind:\s*'square'/);

    // The discriminator must marshal directly to the matching branch, so a
    // Square must not gain a spurious `radius` from the Circle branch.
    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi
        .fn()
        .mockResolvedValue({ canonical: { kind: 'square', side: 3 } }),
    });
    const response = await callGeneratedClient(client, mockFetch, 'getShapes');
    expect(response.canonical).toEqual({ kind: 'square', side: 3 });
    expect('radius' in response.canonical).toBe(false);

    expect(types).toMatchSnapshot();
    expect(client).toMatchSnapshot();
  });

  it('should marshal an inheritance-style discriminator base to its subtype', async () => {
    // A base object schema carries the discriminator; subtypes allOf-compose
    // it. A response typed as the base must still round-trip subtype-only
    // fields (here a date) rather than dropping them.
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/pets/{id}': {
          get: {
            operationId: 'getPet',
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Pet' },
                  },
                },
              },
            },
          },
          put: {
            operationId: 'putPet',
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Pet' },
                },
              },
            },
            responses: { '200': { description: 'ok' } },
          },
        },
      },
      components: {
        schemas: {
          Pet: {
            type: 'object',
            required: ['petType', 'name'],
            properties: {
              petType: { type: 'string' },
              name: { type: 'string' },
              bornAt: { type: 'string', format: 'date-time' },
            },
            discriminator: {
              propertyName: 'petType',
              mapping: {
                cat: '#/components/schemas/Cat',
                dog: '#/components/schemas/Dog',
              },
            },
          } as never,
          Cat: {
            allOf: [
              { $ref: '#/components/schemas/Pet' },
              {
                type: 'object',
                required: ['lastNapAt'],
                properties: {
                  lastNapAt: { type: 'string', format: 'date-time' },
                },
              },
            ],
          },
          Dog: {
            allOf: [
              { $ref: '#/components/schemas/Pet' },
              {
                type: 'object',
                properties: { packSize: { type: 'integer' } },
              },
            ],
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));
    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });
    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
    ]);
    const client = tree.read('src/generated/client.gen.ts', 'utf-8')!;

    // The base dispatches to subtypes; subtypes compose the base's
    // non-dispatching body (no infinite recursion).
    expect(client).toContain('$toJsonBase');
    expect(client).toContain('$IO.Pet.$toJsonBase(model)');
    expect(client).toMatch(/case 'cat':\s*return \$IO\.Cat\.toJson/);

    // GET: a Cat payload through the Pet-typed response revives lastNapAt.
    const getFetch = vi.fn();
    getFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        petType: 'cat',
        name: 'felix',
        bornAt: '2020-01-02T03:04:05.000Z',
        lastNapAt: '2024-01-02T03:04:05.000Z',
      }),
    });
    const getRes = await callGeneratedClient(client, getFetch, 'getPet', {
      id: 'felix',
    });
    expect(getRes.lastNapAt).toEqual(new Date('2024-01-02T03:04:05.000Z'));
    expect(getRes.bornAt).toEqual(new Date('2020-01-02T03:04:05.000Z'));

    // PUT: a Cat through the Pet-typed body serialises lastNapAt.
    const putFetch = vi.fn();
    putFetch.mockResolvedValue({ status: 200 });
    await callGeneratedClient(client, putFetch, 'putPet', {
      id: 'felix',
      petType: 'cat',
      name: 'felix',
      bornAt: new Date('2020-01-02T03:04:05.000Z'),
      lastNapAt: new Date('2024-01-02T03:04:05.000Z'),
    } as never);
    const [, putRequest] = putFetch.mock.calls[0];
    expect(JSON.parse(putRequest.body)).toEqual({
      petType: 'cat',
      name: 'felix',
      bornAt: '2020-01-02T03:04:05.000Z',
      lastNapAt: '2024-01-02T03:04:05.000Z',
    });
  });

  it('marshals a polymorphic list as an array of a discriminated union', async () => {
    // The supported shape for a polymorphic list: an array whose items are a
    // discriminated union (not a oneOf of arrays). Each element marshals to its
    // matching branch, so branch-only dates round-trip without leaking.
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/pets': {
          get: {
            operationId: 'listPets',
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Animal' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Cat: {
            type: 'object',
            required: ['kind', 'napAt'],
            properties: {
              kind: { type: 'string' },
              napAt: { type: 'string', format: 'date-time' },
            },
          },
          Dog: {
            type: 'object',
            required: ['kind', 'walkAt'],
            properties: {
              kind: { type: 'string' },
              walkAt: { type: 'string', format: 'date-time' },
            },
          },
          Animal: {
            oneOf: [
              { $ref: '#/components/schemas/Cat' },
              { $ref: '#/components/schemas/Dog' },
            ],
            discriminator: {
              propertyName: 'kind',
              mapping: {
                cat: '#/components/schemas/Cat',
                dog: '#/components/schemas/Dog',
              },
            },
          } as never,
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));
    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });
    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
    ]);
    const types = tree.read('src/generated/types.gen.ts', 'utf-8')!;
    const client = tree.read('src/generated/client.gen.ts', 'utf-8')!;
    expect(types).toMatchSnapshot('types.gen.ts');
    expect(client).toMatchSnapshot('client.gen.ts');

    // A mixed list: each element deserialises via its own branch, so the Cat
    // keeps napAt and the Dog keeps walkAt with no cross-branch leakage.
    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue([
        { kind: 'cat', napAt: '2024-01-02T03:04:05.000Z' },
        { kind: 'dog', walkAt: '2024-06-07T08:09:10.000Z' },
      ]),
    });
    const response = await callGeneratedClient(client, mockFetch, 'listPets');
    expect(response).toEqual([
      { kind: 'cat', napAt: new Date('2024-01-02T03:04:05.000Z') },
      { kind: 'dog', walkAt: new Date('2024-06-07T08:09:10.000Z') },
    ]);
    expect('walkAt' in response[0]).toBe(false);
    expect('napAt' in response[1]).toBe(false);
  });
});
