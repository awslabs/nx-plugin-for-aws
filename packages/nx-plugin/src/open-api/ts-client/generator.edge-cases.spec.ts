/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { expectTypeScriptToCompile } from '../../utils/test/ts.spec';
import type { Spec } from '../utils/types';
import { openApiTsClientGenerator } from './generator';
import {
  baseUrl,
  callGeneratedClient,
  callGeneratedClientStreaming,
  mockJsonlStreamingFetch,
} from './generator.utils.spec';

/**
 * Regression coverage for edge cases surfaced by differentially testing a
 * corner-case spec corpus against the hey-api-based generator:
 *  A. path-level (shared) parameters with collection schemas (arrays of
 *     dates/refs) must be marshalled, not passed through raw
 *  B. parameters sharing a name across `in` positions must not collide
 *  C. a `null` enum member must mark the enum nullable, not render `| ''`
 *  D. allOf with sibling `properties` must keep the sibling fields in both
 *     the type and the runtime marshalling
 *  E. inline (non-$ref) streaming `itemSchema` must produce a valid item type
 *  F. enum literal values containing quotes/newlines/backslashes must escape
 */
describe('openApiTsClientGenerator - edge cases', () => {
  let tree: Tree;
  const title = 'TestApi';

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const generate = async (spec: Spec) => {
    tree.write('openapi.json', JSON.stringify(spec));
    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });
    expectTypeScriptToCompile(tree, [
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
    ]);
    const types = tree.read('src/generated/types.gen.ts', 'utf-8')!;
    const client = tree.read('src/generated/client.gen.ts', 'utf-8')!;
    expect(types).toMatchSnapshot('types.gen.ts');
    expect(client).toMatchSnapshot('client.gen.ts');
    return { types, client };
  };

  // ---- A. shared path-level collection parameters -------------------------

  it('marshals shared path-level array parameters (dates and refs)', async () => {
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/things': {
          parameters: [
            {
              name: 'whens',
              in: 'query',
              required: true,
              schema: {
                type: 'array',
                items: { type: 'string', format: 'date-time' },
              },
            },
            {
              name: 'things',
              in: 'query',
              schema: {
                type: 'array',
                items: { $ref: '#/components/schemas/Thing' },
              },
            },
          ],
          get: {
            operationId: 'getThings',
            responses: { '200': { description: 'ok' } },
          },
          put: {
            operationId: 'putThings',
            responses: { '200': { description: 'ok' } },
          },
        },
      },
      components: {
        schemas: {
          Thing: {
            type: 'object',
            properties: { at: { type: 'string', format: 'date-time' } },
          },
        },
      },
    };
    const { client } = await generate(spec);

    // Dates must be serialised, and refs marshalled via their model.
    expect(client).toContain('item0.toISOString()');
    expect(client).toContain('$IO.Thing.toJson');
    expect(client).not.toContain('$IO.undefined');

    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({ status: 200 });
    await callGeneratedClient(client, mockFetch, 'getThings', {
      whens: [new Date('2024-01-02T03:04:05.000Z')],
      things: [{ at: new Date('2024-06-07T08:09:10.000Z') }],
    });
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/things?whens=2024-01-02T03%3A04%3A05.000Z&things=%5Bobject%20Object%5D`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  // ---- B. same parameter name in different positions ----------------------

  it('keeps parameters with the same name in path and query distinct', async () => {
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/items/{id}': {
          get: {
            operationId: 'getItem',
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
              {
                name: 'id',
                in: 'query',
                schema: { type: 'string', format: 'date-time' },
              },
            ],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
      components: { schemas: {} },
    };
    const { types } = await generate(spec);

    // The path `id` is a plain string; only the query `id` is a Date.
    expect(types).toMatch(/GetItemRequestPathParameters = \{\s*id: string;/);
    expect(types).toMatch(/GetItemRequestQueryParameters = \{\s*id\?: Date;/);
  });

  // ---- C. null enum members ------------------------------------------------

  it('treats a null enum member as nullable, not an empty literal', async () => {
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/status': {
          get: {
            operationId: 'getStatus',
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Status' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Status: {
            type: 'string',
            nullable: true,
            enum: ['active', 'inactive', null],
          } as never,
        },
      },
    };
    const { types } = await generate(spec);

    expect(types).toContain("'active'");
    expect(types).toContain("'inactive'");
    expect(types).not.toMatch(/\|\s*''/);
  });

  // ---- D. allOf with sibling properties ------------------------------------

  it('keeps sibling properties declared alongside allOf', async () => {
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/dogs': {
          post: {
            operationId: 'createDog',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Dog' },
                },
              },
            },
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Dog' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Base: {
            type: 'object',
            properties: { id: { type: 'string' } },
          },
          Dog: {
            type: 'object',
            allOf: [{ $ref: '#/components/schemas/Base' }],
            properties: { bark: { type: 'boolean' } },
            required: ['bark'],
          },
        },
      },
    };
    const { types, client } = await generate(spec);

    // The sibling property is part of the type...
    expect(types).toMatch(/bark: boolean/);

    // ...and survives a request/response round trip.
    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({ id: 'rex', bark: true }),
    });
    const response = await callGeneratedClient(client, mockFetch, 'createDog', {
      id: 'rex',
      bark: true,
    });
    expect(response).toEqual({ id: 'rex', bark: true });
    const [, request] = mockFetch.mock.calls[0];
    expect(JSON.parse(request.body)).toEqual({ id: 'rex', bark: true });
  });

  // ---- E. inline streaming itemSchema ---------------------------------------

  it('handles an inline object itemSchema on a streaming response', async () => {
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/stream': {
          get: {
            operationId: 'streamThings',
            responses: {
              '200': {
                description: 'stream',
                content: {
                  'application/x-ndjson': {
                    itemSchema: {
                      type: 'object',
                      properties: { line: { type: 'string' } },
                      required: ['line'],
                    },
                  },
                } as never,
              },
            },
          },
        },
      },
      components: { schemas: {} },
    };
    const { types, client } = await generate(spec);

    // The inline item schema is hoisted to a named model.
    expect(types).toContain('StreamThings200ResponseItem');
    expect(client).toContain(
      'AsyncIterableIterator<StreamThings200ResponseItem>',
    );

    const mockFetch = mockJsonlStreamingFetch(200, [
      '{"line":"first"}',
      '{"line":"second"}',
    ]);
    const chunks: unknown[] = [];
    for await (const chunk of await callGeneratedClientStreaming(
      client,
      mockFetch,
      'streamThings',
    )) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([{ line: 'first' }, { line: 'second' }]);
  });

  it('handles an inline primitive itemSchema on a streaming response', async () => {
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/stream': {
          get: {
            operationId: 'streamNumbers',
            responses: {
              '200': {
                description: 'stream',
                content: {
                  'application/x-ndjson': {
                    itemSchema: { type: 'number' },
                  },
                } as never,
              },
            },
          },
        },
      },
      components: { schemas: {} },
    };
    const { client } = await generate(spec);

    expect(client).toContain('AsyncIterableIterator<number>');

    const mockFetch = mockJsonlStreamingFetch(200, ['1', '2', '3']);
    const chunks: unknown[] = [];
    for await (const chunk of await callGeneratedClientStreaming(
      client,
      mockFetch,
      'streamNumbers',
    )) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([1, 2, 3]);
  });

  // ---- F. enum literal escaping ---------------------------------------------

  it('escapes quotes, backslashes and newlines in enum values', async () => {
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/tricky': {
          get: {
            operationId: 'getTricky',
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Tricky' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Tricky: {
            type: 'string',
            enum: ["don't", 'back\\slash', 'new\nline'],
          },
        },
      },
    };
    const { types, client } = await generate(spec);

    // The formatter may render either quote style; the values must be escaped
    // so the emitted literals parse (compilation is asserted above).
    expect(types).toContain(String.raw`"don't"`);
    expect(types).toContain(String.raw`'back\\slash'`);
    expect(types).toContain(String.raw`'new\nline'`);

    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue("don't"),
    });
    const response = await callGeneratedClient(client, mockFetch, 'getTricky');
    expect(response).toEqual("don't");
  });
});
