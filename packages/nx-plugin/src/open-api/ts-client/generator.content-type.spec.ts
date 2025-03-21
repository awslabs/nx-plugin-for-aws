/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { openApiTsClientGenerator } from './generator';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { Spec } from '../utils/types';
import { importTypeScriptModule } from '../../utils/js';
import {
  baseUrl,
  callGeneratedClient,
  expectTypeScriptToCompile,
} from './generator.utils.spec';
import { Tree } from '@nx/devkit';

describe('openApiTsClientGenerator - content type header', () => {
  let tree: Tree;
  const title = 'TestApi';

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const validateTypeScript = (paths: string[]) => {
    expectTypeScriptToCompile(tree, paths);
  };

  it('should add the appropriate content type header by default', async () => {
    const spec: Spec = {
      info: {
        title,
        version: '1.0.0',
      },
      openapi: '3.0.0',
      paths: {
        '/json': {
          post: {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: {
                        type: 'string',
                      },
                    },
                  },
                },
              },
            },
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
        '/text': {
          post: {
            requestBody: {
              required: true,
              content: {
                'text/plain': {
                  schema: {
                    type: 'string',
                  },
                },
              },
            },
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

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');

    const mockFetch = vi.fn();

    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue(['a', 'b', 'c']),
    });

    expect(
      await callGeneratedClient(client, mockFetch, 'postJson', {
        message: 'hi',
      }),
    ).toEqual(['a', 'b', 'c']);
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/json`,
      expect.objectContaining({
        method: 'POST',
        headers: [['Content-Type', 'application/json']],
      }),
    );

    expect(
      await callGeneratedClient(client, mockFetch, 'postText', 'hello'),
    ).toEqual(['a', 'b', 'c']);
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/text`,
      expect.objectContaining({
        method: 'POST',
        headers: [['Content-Type', 'text/plain']],
      }),
    );
  });

  it('should allow omitting auto content type header', async () => {
    const spec: Spec = {
      info: {
        title,
        version: '1.0.0',
      },
      openapi: '3.0.0',
      paths: {
        '/json': {
          post: {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: {
                        type: 'string',
                      },
                    },
                  },
                },
              },
            },
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

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');

    const mockFetch = vi.fn();

    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue(['a', 'b', 'c']),
    });

    const { TestApi } = await importTypeScriptModule<any>(client);
    const c = new TestApi({
      url: baseUrl,
      fetch: mockFetch,
      options: { omitContentTypeHeader: true },
    });

    expect(await c.postJson({ message: 'hi' })).toEqual(['a', 'b', 'c']);
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/json`,
      expect.objectContaining({
        method: 'POST',
        headers: [], // No content-type header added
      }),
    );
  });
});
