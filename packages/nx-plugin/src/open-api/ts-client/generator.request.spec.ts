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

describe('openApiTsClientGenerator - requests', () => {
  let tree: Tree;
  const title = 'TestApi';

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const validateTypeScript = (paths: string[]) => {
    expectTypeScriptToCompile(tree, paths);
  };

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
});
