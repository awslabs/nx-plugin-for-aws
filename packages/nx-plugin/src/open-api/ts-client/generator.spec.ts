/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { openApiTsClientGenerator } from './generator';
import { createProjectSync } from '@ts-morph/bootstrap';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { Spec } from '../utils/types';
import ts from 'typescript';
import { importTypeScriptModule } from '../../utils/js';
import { Mock } from 'vitest';

describe('openApiTsClientGenerator', () => {
  let tree: Tree;
  const title = 'TestApi';
  const baseUrl = 'https://example.com';

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const validateTypeScript = (paths: string[]) => {
    const project = createProjectSync({
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        skipLibCheck: true,
        strict: true,
      },
    });
    paths.forEach((p) => {
      project.createSourceFile(p, tree.read(p, 'utf-8'));
    });

    const program = project.createProgram();

    const diagnostics = [
      ...program.getSemanticDiagnostics(),
      ...program.getSyntacticDiagnostics(),
    ];

    if (diagnostics.length > 0) {
      console.log(project.formatDiagnosticsWithColorAndContext(diagnostics));
    }
    expect(diagnostics).toHaveLength(0);
  };

  const callGeneratedClient = async (
    clientModule: string,
    mockFetch: Mock<any, any>,
    op: string,
    parameters?: any,
  ): Promise<any> => {
    const { TestApi } = await importTypeScriptModule<any>(clientModule);
    const client = new TestApi({ url: baseUrl, fetch: mockFetch });
    const clientMethod = op.split('.').reduce((m, opPart) => m[opPart], client);
    return await clientMethod(parameters);
  };

  it('should generate valid TypeScript for primitive types', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/test': {
          get: {
            operationId: 'getTest',
            description: 'Sends a test request!',
            responses: {
              '200': {
                description: 'getTest',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        string: { type: 'string' },
                        number: { type: 'number' },
                        integer: { type: 'integer' },
                        boolean: { type: 'boolean' },
                        'nullable-string': { type: 'string', nullable: true },
                        optionalNumber: { type: 'number' },
                      },
                      required: ['string', 'number', 'integer', 'boolean'],
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
        string: 'str',
        number: 42.3,
        integer: 33,
        boolean: true,
        'nullable-string': null,
      }),
    });
    const response = await callGeneratedClient(client, mockFetch, 'getTest');
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/test`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(response).toEqual({
      string: 'str',
      number: 42.3,
      integer: 33,
      boolean: true,
      nullableString: null,
    });
  });

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

  it('should generate valid TypeScript for parameters and responses', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/test/{id}': {
          get: {
            operationId: 'getTest',
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
              {
                name: 'filter',
                in: 'query',
                schema: { type: 'string' },
              },
              {
                name: 'tags',
                in: 'query',
                style: 'form',
                explode: true,
                schema: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
              {
                name: 'x-api-key',
                in: 'header',
                required: true,
                schema: { type: 'string' },
              },
            ],
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
              '400': {
                description: 'test',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        error: { type: 'string' },
                      },
                    },
                  },
                },
              },
              '404': {
                description: 'Not found',
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

    // Test successful response
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        result: 'success',
      }),
    });

    const response = await callGeneratedClient(client, mockFetch, 'getTest', {
      id: 'test123',
      filter: 'active',
      tags: ['tag1', 'tag2'],
      xApiKey: 'api-key-123',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/test/test123?filter=active&tags=tag1&tags=tag2`,
      expect.objectContaining({
        method: 'GET',
        headers: [['x-api-key', 'api-key-123']],
      }),
    );
    expect(response).toEqual({ result: 'success' });

    // Test 400 error response
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 400,
      json: vi.fn().mockResolvedValue({
        error: 'Invalid request',
      }),
    });

    await expect(
      callGeneratedClient(client, mockFetch, 'getTest', {
        id: 'invalid',
        xApiKey: 'api-key-123',
      }),
    ).rejects.toThrow(
      expect.objectContaining({
        status: 400,
        error: {
          error: 'Invalid request',
        },
      }),
    );

    // Test 404 response
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 404,
    });

    await expect(
      callGeneratedClient(client, mockFetch, 'getTest', {
        id: 'nonexistent',
        xApiKey: 'api-key-123',
      }),
    ).rejects.toThrow(expect.objectContaining({ status: 404 }));
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

  it('should handle operation tags and multiple services', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/users': {
          get: {
            tags: ['users'],
            operationId: 'getUsers',
            responses: {
              '200': {
                description: 'test',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
          post: {
            tags: ['users'],
            operationId: 'createUser',
            responses: {
              '201': {
                description: 'test',
                content: {
                  'application/json': {
                    schema: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        '/items': {
          get: {
            tags: ['items'],
            operationId: 'getItems',
            description: 'Returns a list of all the items',
            responses: {
              '200': {
                description: 'test',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        '/status': {
          get: {
            operationId: 'getStatus',
            responses: {
              '200': {
                description: 'test',
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

    // Test getUsers
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue(['user1', 'user2', 'user3']),
    });

    const users = await callGeneratedClient(
      client,
      mockFetch,
      'users.getUsers',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/users`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(users).toEqual(['user1', 'user2', 'user3']);

    // Test createUser
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 201,
      text: vi.fn().mockResolvedValue('newUser123'),
    });

    const newUser = await callGeneratedClient(
      client,
      mockFetch,
      'users.createUser',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/users`,
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(newUser).toBe('newUser123');

    // Test getItems
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue(['item1', 'item2']),
    });

    const items = await callGeneratedClient(
      client,
      mockFetch,
      'items.getItems',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/items`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(items).toEqual(['item1', 'item2']);

    // Test getStatus
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue('healthy'),
    });

    const status = await callGeneratedClient(client, mockFetch, 'getStatus');
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/status`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(status).toBe('healthy');
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

  it('should handle operations with multiple tags', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/multi-tagged': {
          get: {
            tags: ['tag1', 'tag2', 'tag3'],
            operationId: 'getMultiTagged',
            responses: {
              '200': {
                description: 'test',
                content: {
                  'application/json': {
                    schema: { type: 'string' },
                  },
                },
              },
            },
          },
          post: {
            tags: ['tag1', 'tag3'],
            operationId: 'postMultiTagged',
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

    // Check that the client has the methods under the appropriate tags
    const { TestApi } = await importTypeScriptModule<any>(client);
    const c = new TestApi({ url: baseUrl, fetch: vi.fn() });

    expect(c.tag1.getMultiTagged).toBeDefined();
    expect(c.tag2.getMultiTagged).toBeDefined();
    expect(c.tag3.getMultiTagged).toBeDefined();

    expect(c.tag1.postMultiTagged).toBeDefined();
    expect(c.tag2.postMultiTagged).not.toBeDefined();
    expect(c.tag3.postMultiTagged).toBeDefined();
  });

  it('should handle number and string constraints', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/constraints': {
          post: {
            operationId: 'testConstraints',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      constrainedInt: {
                        type: 'integer',
                        minimum: 3,
                        maximum: 7,
                        exclusiveMinimum: true,
                        exclusiveMaximum: true,
                      },
                      constrainedString: {
                        type: 'string',
                        minLength: 4,
                        maxLength: 10,
                      },
                      hostname: {
                        type: 'string',
                        format: 'hostname',
                      },
                      ipv4: {
                        type: 'string',
                        format: 'ipv4',
                      },
                      ipv6: {
                        type: 'string',
                        format: 'ipv6',
                      },
                      uri: {
                        type: 'string',
                        format: 'uri',
                      },
                    },
                    required: ['constrainedInt', 'constrainedString'],
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

    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({ result: 'success' }),
    });

    const testData = {
      constrainedInt: 5,
      constrainedString: 'test1234',
      hostname: 'example.com',
      ipv4: '192.168.1.1',
      ipv6: '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
      uri: 'https://example.com',
    };

    expect(
      await callGeneratedClient(client, mockFetch, 'testConstraints', testData),
    ).toEqual({ result: 'success' });

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/constraints`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(testData),
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

  it('should handle default responses', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/test': {
          get: {
            operationId: 'getTest',
            responses: {
              '200': {
                description: 'Success',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        message: { type: 'string' },
                      },
                      required: ['message'],
                    },
                  },
                },
              },
              default: {
                description: 'Error',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        error: { type: 'string' },
                      },
                      required: ['error'],
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

    // Test successful response
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({ message: 'Success' }),
    });
    expect(await callGeneratedClient(client, mockFetch, 'getTest')).toEqual({
      message: 'Success',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/test`,
      expect.objectContaining({
        method: 'GET',
      }),
    );

    // Test default error response
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 500,
      json: vi.fn().mockResolvedValue({ error: 'Internal Server Error' }),
    });
    await expect(
      callGeneratedClient(client, mockFetch, 'getTest'),
    ).rejects.toThrow(
      expect.objectContaining({
        status: 500,
        error: { error: 'Internal Server Error' },
      }),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/test`,
      expect.objectContaining({
        method: 'GET',
      }),
    );

    // Test default error response with another status code
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 404,
      json: vi.fn().mockResolvedValue({ error: 'Not found' }),
    });
    await expect(
      callGeneratedClient(client, mockFetch, 'getTest'),
    ).rejects.toThrow(
      expect.objectContaining({ status: 404, error: { error: 'Not found' } }),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/test`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('should handle only default response', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/test': {
          get: {
            operationId: 'getTest',
            responses: {
              default: {
                description: 'Response',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        message: { type: 'string' },
                      },
                      required: ['message'],
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

    // Test successful response
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({ message: 'Success' }),
    });
    expect(await callGeneratedClient(client, mockFetch, 'getTest')).toEqual({
      message: 'Success',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/test`,
      expect.objectContaining({
        method: 'GET',
      }),
    );

    // Test another response status code
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 400,
      json: vi.fn().mockResolvedValue({ message: 'Another' }),
    });
    expect(await callGeneratedClient(client, mockFetch, 'getTest')).toEqual({
      message: 'Another',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/test`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('should handle multiple response status codes', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/test': {
          post: {
            operationId: 'testResponses',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'string' },
                    },
                  },
                },
              },
            },
            responses: {
              '2XX': {
                description: 'Success',
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
              '500': {
                description: 'Specific 500 error',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        reason: { type: 'string' },
                      },
                    },
                  },
                },
              },
              '5XX': {
                description: 'Internal Server Error',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        error: { type: 'string' },
                        trace: { type: 'string' },
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

    // Test 2XX responses as result
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({ result: 'Success' }),
    });
    expect(
      await callGeneratedClient(client, mockFetch, 'testResponses'),
    ).toEqual({ result: 'Success' });
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/test`,
      expect.objectContaining({
        method: 'POST',
      }),
    );

    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 201,
      json: vi.fn().mockResolvedValue({ result: 'Another Success' }),
    });
    expect(
      await callGeneratedClient(client, mockFetch, 'testResponses'),
    ).toEqual({ result: 'Another Success' });
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/test`,
      expect.objectContaining({
        method: 'POST',
      }),
    );

    // Test explicit 500 error
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 500,
      json: vi.fn().mockResolvedValue({ reason: 'fail' }),
    });
    await expect(
      callGeneratedClient(client, mockFetch, 'testResponses'),
    ).rejects.toThrow(
      expect.objectContaining({ status: 500, error: { reason: 'fail' } }),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/test`,
      expect.objectContaining({
        method: 'POST',
      }),
    );

    // Test other 5XX errors
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 503,
      json: vi.fn().mockResolvedValue({ error: 'fail' }),
    });
    await expect(
      callGeneratedClient(client, mockFetch, 'testResponses'),
    ).rejects.toThrow(
      expect.objectContaining({ status: 503, error: { error: 'fail' } }),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/test`,
      expect.objectContaining({
        method: 'POST',
      }),
    );

    // Test other 5XX errors
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 504,
      json: vi.fn().mockResolvedValue({ error: 'fail 2' }),
    });
    await expect(
      callGeneratedClient(client, mockFetch, 'testResponses'),
    ).rejects.toThrow(
      expect.objectContaining({ status: 504, error: { error: 'fail 2' } }),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/test`,
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('should handle special formats and vendor extensions', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/test': {
          post: {
            operationId: 'postTest',
            ...{
              'x-aws-api-integration': {
                type: 'aws_proxy',
              },
            },
            parameters: [
              {
                name: 'date',
                in: 'query',
                schema: { type: 'string', format: 'date' },
              },
              {
                name: 'timestamp',
                in: 'query',
                schema: { type: 'string', format: 'date-time' },
              },
            ],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      int32: { type: 'integer', format: 'int32' },
                      int64: { type: 'integer', format: 'int64' },
                      float: { type: 'number', format: 'float' },
                      double: { type: 'number', format: 'double' },
                      binary: { type: 'string', format: 'binary' },
                      byte: { type: 'string', format: 'byte' },
                      uuid: { type: 'string', format: 'uuid' },
                      email: { type: 'string', format: 'email' },
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
                        createdAt: { type: 'string', format: 'date-time' },
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

  it('should handle request body property matching query parameter name', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/test': {
          post: {
            operationId: 'postTest',
            parameters: [
              {
                name: 'filter',
                in: 'query',
                schema: { type: 'string' },
              },
            ],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      filter: {
                        type: 'object',
                        properties: { value: { type: 'string' } },
                      },
                      data: { type: 'string' },
                    },
                    required: ['filter', 'data'],
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

    const mockFetch = vi.fn();

    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({ result: 'Success' }),
    });

    expect(
      await callGeneratedClient(client, mockFetch, 'postTest', {
        filter: 'test',
        body: {
          filter: { value: 'test value' },
          data: 'test data',
        },
      }),
    ).toEqual({ result: 'Success' });

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/test?filter=test`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          filter: { value: 'test value' },
          data: 'test data',
        }),
      }),
    );
  });

  it('should handle operations with simple request bodies and query parameters', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/number': {
          post: {
            operationId: 'postNumber',
            requestBody: {
              content: {
                'application/json': {
                  schema: { type: 'number' },
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
        '/string': {
          post: {
            operationId: 'postString',
            requestBody: {
              content: {
                'application/json': {
                  schema: { type: 'string' },
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
        '/boolean': {
          post: {
            operationId: 'postBoolean',
            requestBody: {
              content: {
                'application/json': {
                  schema: { type: 'boolean' },
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
        '/number-with-query': {
          post: {
            operationId: 'postNumberWithQuery',
            parameters: [
              {
                name: 'filter',
                in: 'query',
                schema: { type: 'string' },
              },
            ],
            requestBody: {
              content: {
                'application/json': {
                  schema: { type: 'number' },
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
        '/string-with-query': {
          post: {
            operationId: 'postStringWithQuery',
            parameters: [
              {
                name: 'filter',
                in: 'query',
                schema: { type: 'string' },
              },
            ],
            requestBody: {
              content: {
                'application/json': {
                  schema: { type: 'string' },
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
        '/boolean-with-query': {
          post: {
            operationId: 'postBooleanWithQuery',
            parameters: [
              {
                name: 'filter',
                in: 'query',
                schema: { type: 'string' },
              },
            ],
            requestBody: {
              content: {
                'application/json': {
                  schema: { type: 'boolean' },
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

    expect(await callGeneratedClient(client, mockFetch, 'postNumber', 42)).toBe(
      'success',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/number`,
      expect.objectContaining({
        method: 'POST',
        body: '42',
      }),
    );

    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue('success'),
    });
    await callGeneratedClient(client, mockFetch, 'postString', 'test');
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/string`,
      expect.objectContaining({
        method: 'POST',
        body: 'test',
      }),
    );

    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue('success'),
    });
    await callGeneratedClient(client, mockFetch, 'postBoolean', true);
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/boolean`,
      expect.objectContaining({
        method: 'POST',
        body: 'true',
      }),
    );

    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue('success'),
    });
    await callGeneratedClient(client, mockFetch, 'postNumberWithQuery', {
      filter: 'test',
      body: 42,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/number-with-query?filter=test`,
      expect.objectContaining({
        method: 'POST',
        body: '42',
      }),
    );

    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue('success'),
    });
    await callGeneratedClient(client, mockFetch, 'postStringWithQuery', {
      filter: 'filter',
      body: 'test',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/string-with-query?filter=filter`,
      expect.objectContaining({
        method: 'POST',
        body: 'test',
      }),
    );

    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue('success'),
    });
    await callGeneratedClient(client, mockFetch, 'postBooleanWithQuery', {
      body: false,
      filter: 'test',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/boolean-with-query?filter=test`,
      expect.objectContaining({
        method: 'POST',
        body: 'false',
      }),
    );
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

  it('should handle enum request and response bodies', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/status': {
          post: {
            operationId: 'updateStatus',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'string',
                    enum: ['pending', 'in_progress', 'completed', 'failed'],
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Updated status result',
                content: {
                  'application/json': {
                    schema: {
                      type: 'string',
                      enum: ['accepted', 'rejected'],
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
      text: vi.fn().mockResolvedValue('accepted'),
    });

    expect(
      await callGeneratedClient(client, mockFetch, 'updateStatus', 'pending'),
    ).toEqual('accepted');
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/status`,
      expect.objectContaining({
        method: 'POST',
        body: 'pending',
      }),
    );
  });

  it('should handle date and date-time formats', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/single-date': {
          post: {
            operationId: 'postSingleDate',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'string',
                    format: 'date',
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: {
                      type: 'string',
                      format: 'date',
                    },
                  },
                },
              },
            },
          },
        },
        '/dates': {
          post: {
            operationId: 'postDates',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      dateOnly: {
                        type: 'string',
                        format: 'date',
                      },
                      dateTime: {
                        type: 'string',
                        format: 'date-time',
                      },
                      dateArray: {
                        type: 'array',
                        items: {
                          type: 'string',
                          format: 'date',
                        },
                      },
                      dateTimeArray: {
                        type: 'array',
                        items: {
                          type: 'string',
                          format: 'date-time',
                        },
                      },
                    },
                    required: ['dateOnly', 'dateTime'],
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
                      type: 'object',
                      properties: {
                        processedDate: {
                          type: 'string',
                          format: 'date',
                        },
                        processedDateTime: {
                          type: 'string',
                          format: 'date-time',
                        },
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

    // Test single date
    mockFetch.mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue('2023-01-01'),
    });
    expect(
      await callGeneratedClient(
        client,
        mockFetch,
        'postSingleDate',
        new Date('2023-12-25'),
      ),
    ).toEqual(new Date('2023-01-01'));
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/single-date`,
      expect.objectContaining({
        method: 'POST',
        body: '2023-12-25',
      }),
    );

    // Test complex date object
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        processedDate: '2023-01-01',
        processedDateTime: '2023-01-01T12:00:00Z',
      }),
    });

    const datePayload = {
      dateOnly: new Date('2023-12-25'),
      dateTime: new Date('2023-12-25T15:30:00Z'),
      dateArray: [new Date('2023-12-26'), new Date('2023-12-27')],
      dateTimeArray: [
        new Date('2023-12-26T10:00:00Z'),
        new Date('2023-12-27T11:00:00Z'),
      ],
    };

    expect(
      await callGeneratedClient(client, mockFetch, 'postDates', datePayload),
    ).toEqual({
      processedDate: new Date('2023-01-01'),
      processedDateTime: new Date('2023-01-01T12:00:00Z'),
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/dates`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          dateOnly: '2023-12-25',
          dateTime: '2023-12-25T15:30:00.000Z',
          dateArray: ['2023-12-26', '2023-12-27'],
          dateTimeArray: [
            '2023-12-26T10:00:00.000Z',
            '2023-12-27T11:00:00.000Z',
          ],
        }),
      }),
    );
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

  it('should allow duplicate operation ids discriminated by tag', async () => {
    const spec: Spec = {
      info: {
        title,
        version: '1.0.0',
      },
      openapi: '3.0.0',
      paths: {
        '/items': {
          get: {
            tags: ['items'],
            operationId: 'list',
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: {
                        type: 'string',
                      },
                    },
                  },
                },
                description: 'Success',
              },
            },
          },
        },
        '/users': {
          get: {
            tags: ['users'],
            operationId: 'list',
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: {
                        type: 'string',
                      },
                    },
                  },
                },
                description: 'Success',
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
      json: vi.fn().mockResolvedValue(['a', 'b', 'c']),
    });

    expect(await callGeneratedClient(client, mockFetch, 'users.list')).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(await callGeneratedClient(client, mockFetch, 'items.list')).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('should allow duplicate operation ids discriminated by multiple tags', async () => {
    const spec: Spec = {
      info: {
        title,
        version: '1.0.0',
      },
      openapi: '3.0.0',
      paths: {
        '/items': {
          get: {
            tags: ['items', 'stock'],
            operationId: 'list',
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: {
                        type: 'string',
                      },
                    },
                  },
                },
                description: 'Success',
              },
            },
          },
        },
        '/users': {
          get: {
            tags: ['users', 'people'],
            operationId: 'list',
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: {
                        type: 'string',
                      },
                    },
                  },
                },
                description: 'Success',
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
      json: vi.fn().mockResolvedValue(['a', 'b', 'c']),
    });

    expect(await callGeneratedClient(client, mockFetch, 'users.list')).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(await callGeneratedClient(client, mockFetch, 'people.list')).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(await callGeneratedClient(client, mockFetch, 'items.list')).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(await callGeneratedClient(client, mockFetch, 'stock.list')).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('should throw for operations with the same id and no tags', async () => {
    const spec: Spec = {
      info: {
        title,
        version: '1.0.0',
      },
      openapi: '3.0.0',
      paths: {
        '/items': {
          get: {
            operationId: 'myOp',
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: {
                        type: 'string',
                      },
                    },
                  },
                },
                description: 'Success',
              },
            },
          },
        },
        '/users': {
          get: {
            operationId: 'myOp',
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: {
                        type: 'string',
                      },
                    },
                  },
                },
                description: 'Success',
              },
            },
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await expect(openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    })).rejects.toThrow('Untagged operations cannot have the same operationId (myOp)');
  });

  it('should throw an error for duplicate operation ids within a tag', async () => {
    const spec: Spec = {
      info: {
        title,
        version: '1.0.0',
      },
      openapi: '3.0.0',
      paths: {
        '/items': {
          get: {
            tags: ['items', 'users'],
            operationId: 'list',
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: {
                        type: 'string',
                      },
                    },
                  },
                },
                description: 'Success',
              },
            },
          },
        },
        '/users': {
          get: {
            tags: ['users'],
            operationId: 'list',
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: {
                        type: 'string',
                      },
                    },
                  },
                },
                description: 'Success',
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
      'Operations with the same tag (users) cannot have the same operationId (list)',
    );
  });
});
