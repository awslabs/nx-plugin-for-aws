/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { Spec } from '../utils/types';
import { PythonVerifier } from '../../utils/test/py.spec';
import {
  callGeneratedClientStreaming,
  callGeneratedClientStreamingAsync,
  createTree,
  generateAndRead,
  mockJsonlResponse,
} from './generator.utils.spec';

describe('openApiPyClientGenerator - streaming', () => {
  let tree: Tree;
  let verifier: PythonVerifier;

  beforeAll(() => {
    verifier = new PythonVerifier();
  });

  afterAll(async () => {
    await verifier.shutdown();
  });

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
    expect(types).toMatchSnapshot('types_gen.py');
    expect(client).toMatchSnapshot('client_gen.py');
    expect(client).toContain('Iterator[types_gen.Chunk]');
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
    expect(client).toContain('Iterator[types_gen.Chunk]');

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

  it('should emit AsyncIterator on the async client', async () => {
    const { asyncClient } = await generateAndRead(verifier, tree, jsonlSpec);
    expect(asyncClient).toContain('AsyncIterator[types_gen.Chunk]');
  });
});
