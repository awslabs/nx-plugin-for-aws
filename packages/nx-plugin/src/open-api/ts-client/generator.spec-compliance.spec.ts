/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { expectTypeScriptToCompile } from '../../utils/test/ts.spec';
import type { Spec } from '../utils/types';
import { openApiTsClientGenerator } from './generator';
import { baseUrl, callGeneratedClient } from './generator.utils.spec';

describe('openApiTsClientGenerator - spec compliance', () => {
  let tree: Tree;
  const title = 'TestApi';

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const validateTypeScript = (paths: string[]) => {
    expectTypeScriptToCompile(tree, paths);
  };

  const generate = async (spec: Spec): Promise<string> => {
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
    expect(client).toMatchSnapshot('client.gen.ts');
    expect(types).toMatchSnapshot('types.gen.ts');
    return client;
  };

  const jsonResponse = (payload: any, status = 200) => ({
    status,
    json: vi.fn().mockResolvedValue(payload),
    text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
  });

  it('should omit the body entirely for an optional request body', async () => {
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/search': {
          post: {
            operationId: 'search',
            requestBody: {
              required: false,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['query'],
                    properties: { query: { type: 'string' } },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': { schema: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    };
    const client = await generate(spec);

    const mockFetch = vi.fn().mockResolvedValue(jsonResponse('ok'));
    expect(await callGeneratedClient(client, mockFetch, 'search')).toBe('ok');
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/search`,
      expect.objectContaining({ body: undefined }),
    );

    mockFetch.mockClear();
    mockFetch.mockResolvedValue(jsonResponse('ok'));
    expect(
      await callGeneratedClient(client, mockFetch, 'search', { query: 'q' }),
    ).toBe('ok');
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/search`,
      expect.objectContaining({ body: JSON.stringify({ query: 'q' }) }),
    );
  });

  it('should serialise matrix and label path styles and allowReserved query parameters', async () => {
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/m/{coords}/l/{tags}': {
          get: {
            operationId: 'styled',
            parameters: [
              {
                name: 'coords',
                in: 'path',
                required: true,
                style: 'matrix',
                schema: { type: 'array', items: { type: 'integer' } },
              },
              {
                name: 'tags',
                in: 'path',
                required: true,
                style: 'label',
                schema: { type: 'array', items: { type: 'string' } },
              },
              {
                name: 'filter',
                in: 'query',
                required: true,
                allowReserved: true,
                schema: { type: 'string' },
              },
            ],
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': { schema: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    };
    const client = await generate(spec);

    const mockFetch = vi.fn().mockResolvedValue(jsonResponse('ok'));
    await callGeneratedClient(client, mockFetch, 'styled', {
      coords: [1, 2, 3],
      tags: ['a', 'b'],
      filter: 'a/b:c',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/m/;coords=1,2,3/l/.a,b?filter=a/b:c`,
      expect.anything(),
    );
  });

  it('should serialise exploded matrix and label path styles', async () => {
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/m/{coords}/l/{tags}': {
          get: {
            operationId: 'styled',
            parameters: [
              {
                name: 'coords',
                in: 'path',
                required: true,
                style: 'matrix',
                explode: true,
                schema: { type: 'array', items: { type: 'integer' } },
              },
              {
                name: 'tags',
                in: 'path',
                required: true,
                style: 'label',
                explode: true,
                schema: { type: 'array', items: { type: 'string' } },
              },
            ],
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': { schema: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    };
    const client = await generate(spec);

    const mockFetch = vi.fn().mockResolvedValue(jsonResponse('ok'));
    await callGeneratedClient(client, mockFetch, 'styled', {
      coords: [1, 2],
      tags: ['a', 'b'],
    });
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/m/;coords=1;coords=2/l/.a.b`,
      expect.anything(),
    );
  });

  it('should JSON-serialise a content-based query parameter with marshalled dates', async () => {
    const spec: Spec = {
      openapi: '3.1.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/query': {
          get: {
            operationId: 'contentParam',
            parameters: [
              {
                name: 'filter',
                in: 'query',
                required: true,
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Filter' },
                  },
                },
              } as any,
            ],
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': { schema: { type: 'string' } },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Filter: {
            type: 'object',
            required: ['field'],
            properties: {
              field: { type: 'string' },
              since: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    };
    const client = await generate(spec);

    const types = tree.read('src/generated/types.gen.ts', 'utf-8')!;
    expect(types).toContain('filter: Filter');

    const mockFetch = vi.fn().mockResolvedValue(jsonResponse('ok'));
    await callGeneratedClient(client, mockFetch, 'contentParam', {
      filter: { field: 'age', since: new Date('2026-01-01T00:00:00Z') },
    });
    const url: string = mockFetch.mock.calls[0][0];
    expect(decodeURIComponent(url.split('filter=')[1])).toBe(
      JSON.stringify({ field: 'age', since: '2026-01-01T00:00:00.000Z' }),
    );
  });

  it('should throw for a content-based parameter with a non-JSON media type', async () => {
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/query': {
          get: {
            operationId: 'contentParam',
            parameters: [
              {
                name: 'filter',
                in: 'query',
                required: true,
                content: {
                  'application/xml': { schema: { type: 'object' } },
                },
              } as any,
            ],
            responses: {
              '200': { description: 'ok' },
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
    ).rejects.toThrow(/application\/xml.*not supported/);
  });

  it('should send multipart parts with content types declared by the encoding object', async () => {
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/documents': {
          post: {
            operationId: 'createDocument',
            requestBody: {
              required: true,
              content: {
                'multipart/form-data': {
                  schema: {
                    type: 'object',
                    required: ['metadata', 'file'],
                    properties: {
                      metadata: {
                        type: 'object',
                        required: ['title'],
                        properties: { title: { type: 'string' } },
                      },
                      file: { type: 'string', format: 'binary' },
                    },
                  },
                  encoding: {
                    metadata: { contentType: 'application/json' },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': { schema: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    };
    const client = await generate(spec);

    const mockFetch = vi.fn().mockResolvedValue(jsonResponse('ok'));
    await callGeneratedClient(client, mockFetch, 'createDocument', {
      metadata: { title: 'report' },
      file: new Blob(['0123456789']),
    });
    const formData: FormData = mockFetch.mock.calls[0][1].body;
    const metadataPart = formData.get('metadata');
    expect(metadataPart).toBeInstanceOf(Blob);
    expect((metadataPart as Blob).type).toBe('application/json');
    expect(JSON.parse(await (metadataPart as Blob).text())).toEqual({
      title: 'report',
    });
  });

  it('should keep a decimal format string un-corrupted and round-trip byte fields', async () => {
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/blob-meta': {
          post: {
            operationId: 'putBlobMeta',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/BlobMeta' },
                },
              },
            },
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/BlobMeta' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          BlobMeta: {
            type: 'object',
            required: ['data', 'price'],
            properties: {
              data: { type: 'string', format: 'byte' },
              price: { type: 'string', format: 'decimal' },
            },
          },
        },
      },
    };
    const client = await generate(spec);

    const precise = '0.30000000000000004123456789';
    const payload = { data: 'aGVsbG8=', price: precise };
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse(payload));
    const res = await callGeneratedClient(
      client,
      mockFetch,
      'putBlobMeta',
      payload,
    );
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual(payload);
    expect(res.price).toBe(precise);
    expect(res.data).toBe('aGVsbG8=');
  });

  it('should parse 4XX range responses as typed errors and 5XX text as raw text', async () => {
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/things/{id}': {
          get: {
            operationId: 'getThing',
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
                  'application/json': { schema: { type: 'string' } },
                },
              },
              '4XX': {
                description: 'client error',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['reason'],
                      properties: { reason: { type: 'string' } },
                    },
                  },
                },
              },
              '5XX': {
                description: 'server error',
                content: {
                  'text/plain': { schema: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    };
    const client = await generate(spec);

    const mock418 = vi
      .fn()
      .mockResolvedValue(jsonResponse({ reason: 'teapot' }, 418));
    await expect(
      callGeneratedClient(client, mock418, 'getThing', { id: 'x' }),
    ).rejects.toEqual({ status: 418, error: { reason: 'teapot' } });

    const mock503 = vi.fn().mockResolvedValue({
      status: 503,
      text: vi.fn().mockResolvedValue('exploded'),
      json: vi.fn().mockRejectedValue(new Error('not json')),
    });
    await expect(
      callGeneratedClient(client, mock503, 'getThing', { id: 'x' }),
    ).rejects.toEqual({ status: 503, error: 'exploded' });
  });
});
