/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import type { Spec } from '../utils/types';
import {
  callGeneratedClientStreaming,
  callGeneratedClientStreamingAsync,
  createPythonClientVerifier,
  createTree,
  generateAndRead,
  mockJsonlResponse,
} from './generator.utils.spec';

describe('openApiPyClientGenerator - streaming', () => {
  let tree: Tree;
  const verifier = createPythonClientVerifier();

  beforeEach(() => {
    tree = createTree();
  });

  const jsonlSpec: Spec = {
    openapi: '3.1.0',
    info: { title: 'TestApi', version: '1.0.0' },
    paths: {
      '/stream': {
        post: {
          operationId: 'streamData',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Req' },
              },
            },
          },
          responses: {
            '200': {
              description: 'stream',
              content: {
                'application/jsonl': {
                  schema: { $ref: '#/components/schemas/Chunk' },
                  itemSchema: { $ref: '#/components/schemas/Chunk' },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Req: {
          type: 'object',
          required: ['prompt'],
          properties: { prompt: { type: 'string' } },
        },
        Chunk: {
          type: 'object',
          required: ['content'],
          properties: { content: { type: 'string' } },
        },
      },
    },
  };

  it('should detect and handle application/jsonl with itemSchema', async () => {
    const { types, client } = await generateAndRead(verifier, tree, jsonlSpec);
    expect(types).toMatchSnapshot('types.py');
    expect(client).toMatchSnapshot('client.py');
    expect(client).toContain('Iterator[types.Chunk]');
    expect(client).toContain('model_validate_json');

    const res = await callGeneratedClientStreaming(
      verifier,
      'stream_data',
      { prompt: 'x' },
      mockJsonlResponse(200, [
        JSON.stringify({ content: 'a' }),
        JSON.stringify({ content: 'b' }),
        JSON.stringify({ content: 'c' }),
      ]),
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual([
      { content: 'a' },
      { content: 'b' },
      { content: 'c' },
    ]);
  });

  it('should handle application/x-ndjson with itemSchema', async () => {
    const spec: Spec = {
      openapi: '3.1.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/ndjson': {
          post: {
            operationId: 'ndjson',
            responses: {
              '200': {
                description: 'stream',
                content: {
                  'application/x-ndjson': {
                    schema: { $ref: '#/components/schemas/Chunk' },
                    itemSchema: { $ref: '#/components/schemas/Chunk' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Chunk: {
            type: 'object',
            required: ['msg'],
            properties: { msg: { type: 'string' } },
          },
        },
      },
    };
    const { client } = await generateAndRead(verifier, tree, spec);
    expect(client).toContain('Iterator[types.Chunk]');

    const res = await callGeneratedClientStreaming(
      verifier,
      'ndjson',
      {},
      {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson' },
        jsonl_lines: [JSON.stringify({ msg: 'x' })],
      },
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual([{ msg: 'x' }]);
  });

  it('should stream through the async client too', async () => {
    await generateAndRead(verifier, tree, jsonlSpec);
    const res = await callGeneratedClientStreamingAsync(
      verifier,
      'stream_data',
      { prompt: 'x' },
      mockJsonlResponse(200, [
        JSON.stringify({ content: 'hello' }),
        JSON.stringify({ content: 'world' }),
      ]),
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual([{ content: 'hello' }, { content: 'world' }]);
  });

  // `AsyncGenerator` rather than `AsyncIterator`: only the former declares
  // `aclose()`, so a caller who stops early can close the stream type-safely.
  it('should emit AsyncGenerator on the async client', async () => {
    const { asyncClient } = await generateAndRead(verifier, tree, jsonlSpec);
    expect(asyncClient).toContain('AsyncGenerator[types.Chunk, None]');
  });

  // A primitive item schema has no `model_validate_json`, so it goes through a
  // TypeAdapter instead of the class method a model item would use.
  it('should stream a primitive item schema', async () => {
    const spec: Spec = {
      openapi: '3.1.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/numbers': {
          get: {
            operationId: 'streamNumbers',
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/jsonl': {
                    schema: { type: 'integer' },
                    itemSchema: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
    };
    const { client } = await generateAndRead(verifier, tree, spec);
    expect(client).toContain('Iterator[int]');
    const res = await callGeneratedClientStreaming(
      verifier,
      'stream_numbers',
      {},
      mockJsonlResponse(200, ['1', '2', '3']),
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual([1, 2, 3]);
    expect(res.pyElementTypes).toEqual(['int', 'int', 'int']);
  });

  // `x-streaming` marks a stream with no `itemSchema`, so each line is parsed
  // to the response schema's own type — matching the return annotation.
  it('should deserialise x-streaming chunks to the declared type', async () => {
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/models': {
          get: {
            operationId: 'streamModels',
            'x-streaming': true,
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Chunk' },
                  },
                },
              },
            },
          },
        },
        '/text': {
          get: {
            operationId: 'streamText',
            'x-streaming': true,
            responses: {
              '200': {
                description: 'OK',
                content: { 'text/plain': { schema: { type: 'string' } } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Chunk: {
            type: 'object',
            required: ['content'],
            properties: { content: { type: 'string' } },
          },
        },
      },
    };
    const { client } = await generateAndRead(verifier, tree, spec);
    expect(client).toContain('Iterator[types.Chunk]');

    const models = await callGeneratedClientStreaming(
      verifier,
      'stream_models',
      {},
      { status: 200, text: '{"content":"a"}\n{"content":"b"}\n' },
    );
    expect(models.ok).toBe(true);
    expect(models.value).toEqual([{ content: 'a' }, { content: 'b' }]);
    expect(models.pyElementTypes).toEqual(['Chunk', 'Chunk']);

    // A text stream keeps its raw chunks: they are fragments, not documents.
    const text = await callGeneratedClientStreaming(
      verifier,
      'stream_text',
      {},
      { status: 200, text: 'first\nsecond\n' },
    );
    expect(text.value).toEqual(['first', 'second']);
  });

  // A non-success status inside a stream must still raise the typed error
  // rather than being yielded as stream content.
  it('should raise the typed error for a non-success streaming status', async () => {
    await generateAndRead(verifier, tree, jsonlSpec);
    const res = await callGeneratedClientStreaming(
      verifier,
      'stream_data',
      { prompt: 'x' },
      { status: 500, json: { message: 'boom' } },
    );
    expect(res.ok).toBe(false);
    expect(res.exception?.type).toBe('StreamDataApiError');
    expect(res.exception?.status).toBe(500);
  });
});
