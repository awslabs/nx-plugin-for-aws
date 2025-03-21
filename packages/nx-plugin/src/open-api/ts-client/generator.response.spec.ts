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

describe('openApiTsClientGenerator - responses', () => {
  let tree: Tree;
  const title = 'TestApi';

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const validateTypeScript = (paths: string[]) => {
    expectTypeScriptToCompile(tree, paths);
  };

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
});
