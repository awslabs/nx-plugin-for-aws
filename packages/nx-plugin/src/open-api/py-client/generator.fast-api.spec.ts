/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import type { Spec } from '../utils/types.js';
import {
  callGeneratedClient,
  callGeneratedClientStreaming,
  createPythonClientVerifier,
  createTree,
  expectSingleRequest,
  generateAndRead,
  mockJsonlResponse,
} from './generator.utils.spec.js';

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
  const verifier = createPythonClientVerifier();

  beforeEach(() => {
    tree = createTree();
  });

  it('round-trips a FastAPI-shaped echo endpoint', async () => {
    const { types, client } = await generateAndRead(
      verifier,
      tree,
      fastApiSpec,
    );
    expect(types).toMatchSnapshot('types.py');
    expect(client).toMatchSnapshot('client.py');

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

  /**
   * FastAPI writes `Optional[T] = Query(description=...)` as an OpenAPI 3.1
   * `anyOf: [T, null]` carrying a `description`, which the generator hoists to a
   * documented module-level alias. That is its own emission path — nothing else
   * produces a standalone alias with a docstring — and it once emitted the
   * docstring on the alias's own line, so the module did not parse.
   */
  describe('documented optional query parameters', () => {
    const documentedOptionalSpec: Spec = {
      openapi: '3.1.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/vessels': {
          get: {
            operationId: 'listVessels',
            parameters: [
              {
                name: 'as_of',
                in: 'query',
                required: false,
                description: 'Read the registry as it stood at this instant',
                schema: {
                  anyOf: [
                    { type: 'string', format: 'date-time' },
                    { type: 'null' },
                  ],
                  description: 'Read the registry as it stood at this instant',
                  title: 'As Of',
                },
              },
              {
                name: 'hull_class',
                in: 'query',
                required: false,
                description: 'Repeatable hull class filter',
                schema: {
                  anyOf: [
                    {
                      type: 'array',
                      items: { $ref: '#/components/schemas/HullClass' },
                    },
                    { type: 'null' },
                  ],
                  description: 'Repeatable hull class filter',
                  title: 'Hull Class',
                },
              },
            ],
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: { HullClass: { type: 'string', enum: ['skiff', 'hauler'] } },
      },
    } as unknown as Spec;

    // `generateAndRead` compiles and imports the module, so a docstring running
    // onto its alias fails here — this is the assertion that was missing.
    it('emits a documented alias on its own line', async () => {
      const { types } = await generateAndRead(
        verifier,
        tree,
        documentedOptionalSpec,
      );
      expect(types).toMatch(
        /^ListVesselsRequestQueryAsOf = datetime\.datetime \| None$/m,
      );
      expect(types).toMatch(
        /^"""Read the registry as it stood at this instant"""$/m,
      );
      // The defect: the alias's own line lost the space after `=` and ran into
      // the docstring, because a slurping EJS tag ate the trailing newline.
      expect(types).not.toMatch(/^[A-Za-z_]\w* =\S/m);
      expect(types).not.toMatch(/None"""/);
    });

    it('sends both parameters on the wire', async () => {
      await generateAndRead(verifier, tree, documentedOptionalSpec);
      const res = await callGeneratedClient(
        verifier,
        'list_vessels',
        { as_of: '2026-09-01T00:00:00', hull_class: ['skiff', 'hauler'] },
        { json: ['ves_1'] },
      );
      expect(res.ok).toBe(true);
      const query = new URL(expectSingleRequest(res).url).searchParams;
      expect(query.get('as_of')).toBe('2026-09-01T00:00:00');
      expect(query.getAll('hull_class')).toEqual(['skiff', 'hauler']);
    });
  });
});
