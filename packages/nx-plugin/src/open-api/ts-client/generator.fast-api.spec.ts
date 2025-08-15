/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { openApiTsClientGenerator } from './generator';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { Spec } from '../utils/types';
import { baseUrl, callGeneratedClient } from './generator.utils.spec';
import { Tree } from '@nx/devkit';
import { expectTypeScriptToCompile } from '../../utils/test/ts.spec';

describe('openApiTsClientGenerator - FastAPI', () => {
  let tree: Tree;
  const title = 'TestApi';

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const validateTypeScript = (paths: string[]) => {
    expectTypeScriptToCompile(tree, paths);
  };

  it('should generate valid TypeScript for FastAPI echo endpoint with validation errors', async () => {
    const spec: Spec = {
      openapi: '3.1.0',
      info: { title, version: '0.1.0' },
      components: {
        schemas: {
          EchoOutput: {
            properties: {
              message: {
                title: 'Message',
                type: 'string',
              },
            },
            required: ['message'],
            title: 'EchoOutput',
            type: 'object',
          },
          HTTPValidationError: {
            properties: {
              detail: {
                items: {
                  $ref: '#/components/schemas/ValidationError',
                },
                title: 'Detail',
                type: 'array',
              },
            },
            title: 'HTTPValidationError',
            type: 'object',
          },
          InternalServerErrorDetails: {
            properties: {
              detail: {
                title: 'Detail',
                type: 'string',
              },
            },
            required: ['detail'],
            title: 'InternalServerErrorDetails',
            type: 'object',
          },
          ValidationError: {
            properties: {
              loc: {
                items: {
                  anyOf: [
                    {
                      type: 'string',
                    },
                    {
                      type: 'integer',
                    },
                  ],
                },
                title: 'Location',
                type: 'array',
              },
              msg: {
                title: 'Message',
                type: 'string',
              },
              type: {
                title: 'Error Type',
                type: 'string',
              },
            },
            required: ['loc', 'msg', 'type'],
            title: 'ValidationError',
            type: 'object',
          },
        },
      },
      paths: {
        '/echo': {
          get: {
            operationId: 'echo',
            parameters: [
              {
                in: 'query',
                name: 'message',
                required: true,
                schema: {
                  title: 'Message',
                  type: 'string',
                },
              },
            ],
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/EchoOutput',
                    },
                  },
                },
                description: 'Successful Response',
              },
              '422': {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/HTTPValidationError',
                    },
                  },
                },
                description: 'Validation Error',
              },
              '500': {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/InternalServerErrorDetails',
                    },
                  },
                },
                description: 'Internal Server Error',
              },
            },
            summary: 'Echo',
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
        message: 'Hello, World',
      }),
    });

    const response = await callGeneratedClient(client, mockFetch, 'echo', {
      message: 'Hello, World',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/echo?message=Hello%2C%20World`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(response).toEqual({ message: 'Hello, World' });

    // Test validation error response (422)
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 422,
      json: vi.fn().mockResolvedValue({
        detail: [
          {
            loc: ['query', 'message'],
            msg: 'field required',
            type: 'value_error.missing',
          },
        ],
      }),
    });

    await expect(
      callGeneratedClient(client, mockFetch, 'echo', {}),
    ).rejects.toThrow();

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/echo`,
      expect.objectContaining({
        method: 'GET',
      }),
    );

    // Test internal server error response (500)
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 500,
      json: vi.fn().mockResolvedValue({
        detail: 'Internal server error occurred',
      }),
    });

    await expect(
      callGeneratedClient(client, mockFetch, 'echo', { message: 'test' }),
    ).rejects.toThrow();

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/echo?message=test`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('should handle FastAPI validation error schemas with anyOf types', async () => {
    const spec: Spec = {
      openapi: '3.1.0',
      info: { title, version: '0.1.0' },
      components: {
        schemas: {
          ValidationError: {
            properties: {
              loc: {
                items: {
                  anyOf: [{ type: 'string' }, { type: 'integer' }],
                },
                title: 'Location',
                type: 'array',
              },
              msg: {
                title: 'Message',
                type: 'string',
              },
              type: {
                title: 'Error Type',
                type: 'string',
              },
            },
            required: ['loc', 'msg', 'type'],
            title: 'ValidationError',
            type: 'object',
          },
        },
      },
      paths: {
        '/test': {
          post: {
            operationId: 'testValidation',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      value: { type: 'integer' },
                    },
                    required: ['value'],
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
              '422': {
                content: {
                  'application/json': {
                    schema: {
                      properties: {
                        detail: {
                          items: {
                            $ref: '#/components/schemas/ValidationError',
                          },
                          type: 'array',
                        },
                      },
                      type: 'object',
                    },
                  },
                },
                description: 'Validation Error',
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
      text: vi.fn().mockResolvedValue('success'),
    });

    const response = await callGeneratedClient(
      client,
      mockFetch,
      'testValidation',
      { value: 42 },
    );

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/test`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ value: 42 }),
      }),
    );
    expect(response).toBe('success');

    // Test validation error with mixed location types
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 422,
      json: vi.fn().mockResolvedValue({
        detail: [
          {
            loc: ['body', 'value'],
            msg: 'ensure this value is greater than 0',
            type: 'value_error.number.not_gt',
          },
          {
            loc: [0, 'nested_field'],
            msg: 'field required',
            type: 'value_error.missing',
          },
        ],
      }),
    });

    await expect(
      callGeneratedClient(client, mockFetch, 'testValidation', { value: -1 }),
    ).rejects.toThrow();
  });
});
