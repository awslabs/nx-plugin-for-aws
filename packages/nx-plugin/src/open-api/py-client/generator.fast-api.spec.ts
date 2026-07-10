/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { Spec } from '../utils/types';
import { PythonVerifier } from '../../utils/test/py.spec';
import {
  callGeneratedClient,
  callGeneratedClientStreaming,
  createTree,
  generateAndRead,
  mockJsonlResponse,
} from './generator.utils.spec';

/**
 * A fixture that mirrors the shape FastAPI emits: OpenAPI 3.1, operationId =
 * bare function name (no tags), application/json responses with $ref, plus a
 * JsonStreamingResponse-style endpoint using `application/jsonl` +
 * `itemSchema`.
 */
const fastApiSpec: Spec = {
  openapi: '3.1.0',
  info: { title: 'DemoApi', version: '0.0.1' },
  paths: {
    '/echo': {
      get: {
        operationId: 'echo',
        parameters: [
          {
            name: 'message',
            in: 'query',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/EchoOutput' },
              },
            },
          },
          '500': {
            description: 'Internal',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/InternalServerErrorDetails',
                },
              },
            },
          },
        },
      },
    },
    '/stream': {
      post: {
        operationId: 'streamChunks',
        parameters: [
          {
            name: 'prompt',
            in: 'query',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'count',
            in: 'query',
            schema: { type: 'integer', default: 3 },
          },
        ],
        responses: {
          '200': {
            description: 'Stream',
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
      EchoOutput: {
        type: 'object',
        required: ['message'],
        properties: { message: { type: 'string' } },
      },
      Chunk: {
        type: 'object',
        required: ['index', 'message'],
        properties: {
          index: { type: 'integer' },
          message: { type: 'string' },
        },
      },
      InternalServerErrorDetails: {
        type: 'object',
        required: ['detail'],
        properties: { detail: { type: 'string' } },
      },
    },
  },
};

describe('openApiPyClientGenerator - fast-api-shaped specs', () => {
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

  it('round-trips a FastAPI-shaped echo endpoint', async () => {
    const { types, client } = await generateAndRead(
      verifier,
      tree,
      fastApiSpec,
    );
    expect(types).toMatchSnapshot('types_gen.py');
    expect(client).toMatchSnapshot('client_gen.py');

    const res = await callGeneratedClient(
      verifier,
      'echo',
      { message: 'hello' },
      { json: { message: 'hello' } },
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual({ message: 'hello' });
  });

  it('yields typed Chunk objects from a jsonl streaming endpoint', async () => {
    await generateAndRead(verifier, tree, fastApiSpec);

    const res = await callGeneratedClientStreaming(
      verifier,
      'stream_chunks',
      { prompt: 'hi', count: 3 },
      mockJsonlResponse(200, [
        JSON.stringify({ index: 0, message: 'a' }),
        JSON.stringify({ index: 1, message: 'b' }),
        JSON.stringify({ index: 2, message: 'c' }),
      ]),
    );
    expect(res.ok).toBe(true);
    expect(res.value).toEqual([
      { index: 0, message: 'a' },
      { index: 1, message: 'b' },
      { index: 2, message: 'c' },
    ]);
  });

  it('surfaces the per-op typed exception for a 500 response', async () => {
    await generateAndRead(verifier, tree, fastApiSpec);

    const res = await callGeneratedClient(
      verifier,
      'echo',
      { message: 'x' },
      { status: 500, json: { detail: 'boom' } },
    );
    expect(res.ok).toBe(false);
    expect(res.exception?.type).toBe('EchoApiError');
    expect(res.exception?.error_type).toBe('Echo500Error');
    expect(res.exception?.status).toBe(500);
  });
});
