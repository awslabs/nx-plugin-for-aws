/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { openApiTsClientGenerator } from './generator';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { Spec } from '../utils/types';
import {
  baseUrl,
  callGeneratedClient,
  expectTypeScriptToCompile,
} from './generator.utils.spec';
import { Tree } from '@nx/devkit';

describe('openApiTsClientGenerator - complex types', () => {
  let tree: Tree;
  const title = 'TestApi';

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const validateTypeScript = (paths: string[]) => {
    expectTypeScriptToCompile(tree, paths);
  };

  it('should generate valid TypeScript for arrays and dictionaries', async () => {
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
                    type: 'object',
                    properties: {
                      stringArray: {
                        type: 'array',
                        items: { type: 'string' },
                      },
                      numberArray: {
                        type: 'array',
                        items: { type: 'number' },
                      },
                      stringDict: {
                        type: 'object',
                        additionalProperties: { type: 'string' },
                      },
                      complexDict: {
                        type: 'object',
                        additionalProperties: {
                          type: 'object',
                          properties: {
                            name: { type: 'string' },
                            value: { type: 'number' },
                          },
                          required: ['name', 'value'],
                        },
                      },
                    },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'postTest',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          tags: {
                            type: 'array',
                            items: { type: 'string' },
                          },
                        },
                        required: ['id'],
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

    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue([
        {
          id: 'test1',
          tags: ['tag1', 'tag2'],
        },
        {
          id: 'test2',
          tags: [],
        },
      ]),
    });

    const testData = {
      stringArray: ['a', 'b', 'c'],
      numberArray: [1, 2, 3],
      stringDict: { key1: 'value1', key2: 'value2' },
      complexDict: {
        item1: { name: 'test1', value: 42 },
        item2: { name: 'test2', value: 43 },
      },
    };

    const response = await callGeneratedClient(
      client,
      mockFetch,
      'postTest',
      testData,
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/test`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(testData),
      }),
    );
    expect(response).toEqual([
      { id: 'test1', tags: ['tag1', 'tag2'] },
      { id: 'test2', tags: [] },
    ]);
  });

  it('should handle refs and hoisting of inline schemas', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      components: {
        schemas: {
          Error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
            },
            required: ['code', 'message'],
          },
        },
      },
      paths: {
        '/test': {
          post: {
            operationId: 'postTest',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      inline: {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                          details: {
                            type: 'object',
                            properties: {
                              age: { type: 'number' },
                              active: { type: 'boolean' },
                            },
                          },
                        },
                      },
                      referenced: { $ref: '#/components/schemas/Error' },
                    },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'ok',
              },
              '400': {
                description: 'test',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Error' },
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

    // Test successful request
    mockFetch.mockResolvedValue({
      status: 200,
    });

    const testData = {
      inline: {
        name: 'test',
        details: {
          age: 25,
          active: true,
        },
      },
      referenced: {
        code: 'TEST_CODE',
        message: 'Test message',
      },
    };

    expect(
      await callGeneratedClient(client, mockFetch, 'postTest', testData),
    ).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/test`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(testData),
      }),
    );

    // Test error response
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 400,
      json: vi.fn().mockResolvedValue({
        code: 'VALIDATION_ERROR',
        message: 'Invalid data',
      }),
    });

    await expect(
      callGeneratedClient(client, mockFetch, 'postTest', testData),
    ).rejects.toThrow();
  });

  it('should handle operations with complex map types', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/map-of-numbers': {
          post: {
            operationId: 'postMapOfNumbers',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    additionalProperties: { type: 'number' },
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
        '/map-of-maps-of-numbers': {
          post: {
            operationId: 'postMapOfMapsOfNumbers',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    additionalProperties: {
                      type: 'object',
                      additionalProperties: { type: 'number' },
                    },
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
        '/map-of-maps-of-arrays-of-numbers': {
          post: {
            operationId: 'postMapOfMapsOfArraysOfNumbers',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    additionalProperties: {
                      type: 'object',
                      additionalProperties: {
                        type: 'array',
                        items: { type: 'number' },
                      },
                    },
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
        '/map-of-objects': {
          post: {
            operationId: 'postMapOfObjects',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    additionalProperties: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        value: { type: 'number' },
                      },
                      required: ['name', 'value'],
                    },
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
        '/map-of-arrays-of-objects': {
          post: {
            operationId: 'postMapOfArraysOfObjects',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    additionalProperties: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                          value: { type: 'number' },
                        },
                        required: ['name', 'value'],
                      },
                    },
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
        '/array-of-maps-of-numbers': {
          post: {
            operationId: 'postArrayOfMapsOfNumbers',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: { type: 'number' },
                    },
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
        '/array-of-maps-of-arrays-of-numbers': {
          post: {
            operationId: 'postArrayOfMapsOfArraysOfNumbers',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: {
                        type: 'array',
                        items: { type: 'number' },
                      },
                    },
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

    mockFetch.mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue('success'),
    });

    await callGeneratedClient(client, mockFetch, 'postMapOfNumbers', {
      a: 1,
      b: 2,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/map-of-numbers`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ a: 1, b: 2 }),
      }),
    );

    mockFetch.mockClear();
    await callGeneratedClient(client, mockFetch, 'postMapOfMapsOfNumbers', {
      a: { x: 1, y: 2 },
      b: { z: 3 },
    });
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/map-of-maps-of-numbers`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ a: { x: 1, y: 2 }, b: { z: 3 } }),
      }),
    );

    mockFetch.mockClear();
    await callGeneratedClient(
      client,
      mockFetch,
      'postMapOfMapsOfArraysOfNumbers',
      {
        a: { x: [1, 2], y: [3] },
        b: { z: [4, 5, 6] },
      },
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/map-of-maps-of-arrays-of-numbers`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ a: { x: [1, 2], y: [3] }, b: { z: [4, 5, 6] } }),
      }),
    );

    mockFetch.mockClear();
    await callGeneratedClient(client, mockFetch, 'postMapOfObjects', {
      a: { name: 'test1', value: 1 },
      b: { name: 'test2', value: 2 },
    });
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/map-of-objects`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          a: { name: 'test1', value: 1 },
          b: { name: 'test2', value: 2 },
        }),
      }),
    );

    mockFetch.mockClear();
    await callGeneratedClient(client, mockFetch, 'postMapOfArraysOfObjects', {
      a: [{ name: 'test1', value: 1 }],
      b: [
        { name: 'test2', value: 2 },
        { name: 'test3', value: 3 },
      ],
    });
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/map-of-arrays-of-objects`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          a: [{ name: 'test1', value: 1 }],
          b: [
            { name: 'test2', value: 2 },
            { name: 'test3', value: 3 },
          ],
        }),
      }),
    );

    mockFetch.mockClear();
    await callGeneratedClient(client, mockFetch, 'postArrayOfMapsOfNumbers', [
      { a: 1, b: 2 },
      { c: 3, d: 4 },
    ]);
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/array-of-maps-of-numbers`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify([
          { a: 1, b: 2 },
          { c: 3, d: 4 },
        ]),
      }),
    );

    mockFetch.mockClear();
    await callGeneratedClient(
      client,
      mockFetch,
      'postArrayOfMapsOfArraysOfNumbers',
      [
        { a: [1, 2], b: [3] },
        { c: [4, 5], d: [6] },
      ],
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/array-of-maps-of-arrays-of-numbers`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify([
          { a: [1, 2], b: [3] },
          { c: [4, 5], d: [6] },
        ]),
      }),
    );
  });

  it('should handle nullable schemas in various contexts', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/test/{pathParam}': {
          post: {
            operationId: 'testNullable',
            parameters: [
              {
                name: 'pathParam',
                in: 'path',
                required: true,
                schema: { type: 'string', nullable: true },
              },
              {
                name: 'queryString',
                in: 'query',
                schema: { type: 'string', nullable: true },
              },
              {
                name: 'queryNumber',
                in: 'query',
                schema: { type: 'number', nullable: true },
              },
              {
                name: 'queryInteger',
                in: 'query',
                schema: { type: 'integer', nullable: true },
              },
              {
                name: 'queryBoolean',
                in: 'query',
                schema: { type: 'boolean', nullable: true },
              },
              {
                name: 'queryArray',
                in: 'query',
                schema: {
                  type: 'array',
                  items: { type: 'string' },
                  nullable: true,
                },
              },
              {
                name: 'queryObject',
                in: 'query',
                schema: {
                  type: 'object',
                  properties: {
                    key: { type: 'string' },
                  },
                  nullable: true,
                },
              },
            ],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      nullableString: { type: 'string', nullable: true },
                      nullableNumber: { type: 'number', nullable: true },
                      nullableInteger: { type: 'integer', nullable: true },
                      nullableBoolean: { type: 'boolean', nullable: true },
                      nullableArray: {
                        type: 'array',
                        items: { type: 'string' },
                        nullable: true,
                      },
                      nullableObject: {
                        type: 'object',
                        properties: {
                          key: { type: 'string' },
                        },
                        nullable: true,
                      },
                      objectWithNullableProps: {
                        type: 'object',
                        properties: {
                          nullableString: { type: 'string', nullable: true },
                          nullableNumber: { type: 'number', nullable: true },
                          nullableInteger: { type: 'integer', nullable: true },
                          nullableBoolean: { type: 'boolean', nullable: true },
                          nullableArray: {
                            type: 'array',
                            items: { type: 'string' },
                            nullable: true,
                          },
                          nullableObject: {
                            type: 'object',
                            properties: {
                              key: { type: 'string' },
                            },
                            nullable: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Success response with nullable fields',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        nullableString: { type: 'string', nullable: true },
                        nullableNumber: { type: 'number', nullable: true },
                        nullableInteger: { type: 'integer', nullable: true },
                        nullableBoolean: { type: 'boolean', nullable: true },
                        nullableArray: {
                          type: 'array',
                          items: { type: 'string' },
                          nullable: true,
                        },
                        nullableObject: {
                          type: 'object',
                          properties: {
                            key: { type: 'string' },
                          },
                          nullable: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/single-nullable-object': {
          post: {
            operationId: 'postSingleNullableObject',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      key: { type: 'string' },
                    },
                    nullable: true,
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
        '/single-nullable-number': {
          post: {
            operationId: 'postSingleNullableNumber',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'number',
                    nullable: true,
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
        '/single-nullable-string': {
          post: {
            operationId: 'postSingleNullableString',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'string',
                    nullable: true,
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
        '/single-nullable-boolean': {
          post: {
            operationId: 'postSingleNullableBoolean',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'boolean',
                    nullable: true,
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
        '/single-nullable-array': {
          post: {
            operationId: 'postSingleNullableArray',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { type: 'string' },
                    nullable: true,
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

    // Test complex nullable request
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        nullableString: null,
        nullableNumber: 123,
        nullableInteger: null,
        nullableBoolean: true,
        nullableArray: ['test'],
        nullableObject: null,
      }),
    });

    await callGeneratedClient(client, mockFetch, 'testNullable', {
      pathParam: null,
      queryString: null,
      queryNumber: null,
      queryInteger: null,
      queryBoolean: null,
      queryArray: null,
      queryObject: null,
      nullableString: null,
      nullableNumber: 123,
      nullableInteger: null,
      nullableBoolean: true,
      nullableArray: ['test'],
      nullableObject: null,
      objectWithNullableProps: {
        nullableString: null,
        nullableNumber: null,
        nullableInteger: null,
        nullableBoolean: null,
        nullableArray: null,
        nullableObject: null,
      },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/test/null?queryString=null&queryNumber=null&queryInteger=null&queryBoolean=null&queryArray=null&queryObject=null`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          nullableString: null,
          nullableNumber: 123,
          nullableInteger: null,
          nullableBoolean: true,
          nullableArray: ['test'],
          nullableObject: null,
          objectWithNullableProps: {
            nullableString: null,
            nullableNumber: null,
            nullableInteger: null,
            nullableBoolean: null,
            nullableArray: null,
            nullableObject: null,
          },
        }),
      }),
    );

    // Test single nullable object
    mockFetch.mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue('success'),
    });

    await callGeneratedClient(
      client,
      mockFetch,
      'postSingleNullableObject',
      null,
    );

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/single-nullable-object`,
      expect.objectContaining({
        method: 'POST',
        body: 'null',
      }),
    );

    // Test single nullable number
    await callGeneratedClient(
      client,
      mockFetch,
      'postSingleNullableNumber',
      null,
    );

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/single-nullable-number`,
      expect.objectContaining({
        method: 'POST',
        body: 'null',
      }),
    );

    // Test single nullable string
    await callGeneratedClient(
      client,
      mockFetch,
      'postSingleNullableString',
      null,
    );

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/single-nullable-string`,
      expect.objectContaining({
        method: 'POST',
        body: 'null',
      }),
    );

    // Test single nullable boolean
    await callGeneratedClient(
      client,
      mockFetch,
      'postSingleNullableBoolean',
      null,
    );

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/single-nullable-boolean`,
      expect.objectContaining({
        method: 'POST',
        body: 'null',
      }),
    );

    // Test single nullable array
    await callGeneratedClient(
      client,
      mockFetch,
      'postSingleNullableArray',
      null,
    );

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/single-nullable-array`,
      expect.objectContaining({
        method: 'POST',
        body: 'null',
      }),
    );
  });

  it('should handle recursive schema references', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      components: {
        schemas: {
          TreeNode: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              children: {
                type: 'array',
                items: { $ref: '#/components/schemas/TreeNode' },
              },
            },
            required: ['id', 'name'],
          },
        },
      },
      paths: {
        '/tree': {
          get: {
            operationId: 'getTree',
            responses: {
              '200': {
                description: 'A tree structure',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/TreeNode' },
                  },
                },
              },
            },
          },
          post: {
            operationId: 'createTree',
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/TreeNode' },
                },
              },
            },
            responses: {
              '201': {
                description: 'Created tree',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/TreeNode' },
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

    const treeData = {
      id: '1',
      name: 'root',
      children: [{ id: '2', name: 'child1', children: [] }],
    };

    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue(treeData),
    });

    expect(await callGeneratedClient(client, mockFetch, 'getTree')).toEqual(
      treeData,
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/tree`,
      expect.objectContaining({
        method: 'GET',
      }),
    );

    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 201,
      json: vi.fn().mockResolvedValue(treeData),
    });

    expect(
      await callGeneratedClient(client, mockFetch, 'createTree', treeData),
    ).toEqual(treeData);
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/tree`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(treeData),
      }),
    );
  });
});
