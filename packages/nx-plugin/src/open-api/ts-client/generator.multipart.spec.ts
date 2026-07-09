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

describe('openApiTsClientGenerator - multipart/form-data', () => {
  let tree: Tree;
  const title = 'TestApi';

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const validateTypeScript = (paths: string[]) => {
    expectTypeScriptToCompile(tree, paths);
  };

  const clientPaths = [
    'src/generated/client.gen.ts',
    'src/generated/types.gen.ts',
  ];

  // A wrapper-object multipart body with a binary file field (3.1 idiom, as
  // emitted by FastAPI for UploadFile), a text field, and an array field.
  const uploadSpec: Spec = {
    info: { title, version: '1.0.0' },
    openapi: '3.1.0',
    paths: {
      '/upload': {
        post: {
          operationId: 'upload',
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: {
                    file: {
                      type: 'string',
                      contentMediaType: 'application/octet-stream',
                    },
                    note: { type: 'string' },
                    tags: { type: 'array', items: { type: 'string' } },
                  },
                  required: ['file'],
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
                    type: 'object',
                    properties: {
                      size: { type: 'integer' },
                      note: { type: 'string' },
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

  it('should type a binary multipart field as Blob', async () => {
    tree.write('openapi.json', JSON.stringify(uploadSpec));
    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    const types = tree.read('src/generated/types.gen.ts', 'utf-8')!;
    expect(types).toContain('file: Blob');
  });

  it('should keep a string field with a textual contentMediaType as a string', async () => {
    // A string field carrying e.g. an embedded JSON document is a string on
    // the wire, not a Blob — only non-textual content media types are binary.
    const spec: Spec = {
      info: { title, version: '1.0.0' },
      openapi: '3.1.0',
      paths: {
        '/upload': {
          post: {
            operationId: 'upload',
            requestBody: {
              required: true,
              content: {
                'multipart/form-data': {
                  schema: {
                    type: 'object',
                    properties: {
                      binary: {
                        type: 'string',
                        contentMediaType: 'application/octet-stream',
                      },
                      metadata: {
                        type: 'string',
                        contentMediaType: 'application/json',
                      },
                    },
                    required: ['binary'],
                  },
                },
              },
            },
            responses: { '204': { description: 'ok' } },
          },
        },
      },
    };
    tree.write('openapi.json', JSON.stringify(spec));
    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    const types = tree.read('src/generated/types.gen.ts', 'utf-8')!;
    expect(types).toContain('binary: Blob');
    expect(types).toContain('metadata?: string');
  });

  it('should match the generated client snapshot', async () => {
    tree.write('openapi.json', JSON.stringify(uploadSpec));
    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    expect(tree.read('src/generated/client.gen.ts', 'utf-8')).toMatchSnapshot(
      'client.gen.ts',
    );
    expect(tree.read('src/generated/types.gen.ts', 'utf-8')).toMatchSnapshot(
      'types.gen.ts',
    );
  });

  it('should compile', async () => {
    tree.write('openapi.json', JSON.stringify(uploadSpec));
    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });
    validateTypeScript(clientPaths);
  });

  it('should send a FormData body with file, primitive and array parts', async () => {
    tree.write('openapi.json', JSON.stringify(uploadSpec));
    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    const client = tree.read('src/generated/client.gen.ts', 'utf-8')!;

    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({ size: 5, note: 'hi' }),
    });

    const fileBlob = new Blob(['hello']);
    const result = await callGeneratedClient(client, mockFetch, 'upload', {
      file: fileBlob,
      note: 'hi',
      tags: ['a', 'b'],
    });
    expect(result).toEqual({ size: 5, note: 'hi' });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`${baseUrl}/upload`);
    expect(init.method).toBe('POST');
    // fetch computes the multipart boundary itself: no Content-Type header set
    expect(
      (init.headers as [string, string][]).find(
        ([k]) => k.toLowerCase() === 'content-type',
      ),
    ).toBeUndefined();

    const body = init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    // FormData wraps an appended Blob in a File; assert its content, not identity
    const filePart = body.get('file') as Blob;
    expect(filePart).toBeInstanceOf(Blob);
    expect(await filePart.text()).toBe('hello');
    expect(body.get('note')).toBe('hi');
    expect(body.getAll('tags')).toEqual(['a', 'b']);
  });

  it('should omit undefined optional multipart fields', async () => {
    tree.write('openapi.json', JSON.stringify(uploadSpec));
    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    const client = tree.read('src/generated/client.gen.ts', 'utf-8')!;
    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({ size: 5 }),
    });

    const fileBlob = new Blob(['hello']);
    await callGeneratedClient(client, mockFetch, 'upload', { file: fileBlob });

    const body = mockFetch.mock.calls[0][1].body as FormData;
    expect(body.has('file')).toBe(true);
    expect(body.has('note')).toBe(false);
    expect(body.has('tags')).toBe(false);
  });
});
