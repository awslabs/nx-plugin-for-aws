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
 *  G. `$ref` path items must be resolved (including when shared by paths)
 *  H. a requestBody with an empty `content` map declares no body
 *  I. vendored `+json` media types must hoist/marshal like application/json
 *  J. schemas nested inside a rewritten schema (multi-type array items,
 *     `const` in a nullable object, allOf siblings) must also be rewritten
 *  K. a query and a header array parameter sharing a name must keep separate
 *     collection-format maps (no duplicate object key)
 *  L. spaceDelimited / pipeDelimited query arrays must serialise with the
 *     correct delimiter (and compile)
 *  M. discriminated oneOf must marshal to the matching branch, not merge every
 *     branch (which leaks fields from the non-matching branches)
 *  N. a discriminator whose wire name differs from its TS name (e.g. `pet-type`)
 *     must dispatch on the TS name in toJson and the wire name in fromJson
 *  O. a `deepObject` query parameter must serialise as `key[prop]=value` pairs
 *  P. a discriminated union must be a true tagged union that narrows on the
 *     discriminator (each branch's discriminator typed as its literal)
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
      json: vi.fn().mockResolvedValue("don't"),
    });
    const response = await callGeneratedClient(client, mockFetch, 'getTricky');
    expect(response).toEqual("don't");
  });

  // ---- G. $ref path items ---------------------------------------------------

  it('resolves $ref path items, sharing one path item across paths', async () => {
    const spec = {
      openapi: '3.1.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/things': { $ref: '#/components/pathItems/ThingPath' },
        '/other-things': { $ref: '#/components/pathItems/ThingPath' },
      },
      components: {
        pathItems: {
          ThingPath: {
            get: {
              responses: {
                '200': {
                  description: 'ok',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: {
                          at: { type: 'string', format: 'date-time' },
                        },
                        required: ['at'],
                      },
                    },
                  },
                },
              },
            },
          },
        },
        schemas: {},
      },
    } as unknown as Spec;
    const { types, client } = await generate(spec);

    // Both paths get an operation, distinctly named, with the date revived.
    expect(client).toContain("this.$url('/things'");
    expect(client).toContain("this.$url('/other-things'");
    expect(types).toContain('GetThings200Response');
    expect(types).toContain('GetOtherThings200Response');

    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({ at: '2024-01-02T03:04:05.000Z' }),
    });
    const response = await callGeneratedClient(client, mockFetch, 'getThings');
    expect(response).toEqual({ at: new Date('2024-01-02T03:04:05.000Z') });
  });

  // ---- H. empty request body content ---------------------------------------

  it('treats a requestBody with an empty content map as no body', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/noop': {
          post: {
            operationId: 'doNoop',
            requestBody: { content: {} },
            responses: { '200': { description: 'ok' } },
          },
        },
      },
      components: { schemas: {} },
    } as unknown as Spec;
    const { client } = await generate(spec);

    // No body parameter means no Content-Type header and an undefined body.
    expect(client).not.toContain("headerParameters['Content-Type']");

    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({ status: 200 });
    await callGeneratedClient(client, mockFetch, 'doNoop');
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/noop`,
      expect.objectContaining({ method: 'POST', body: undefined }),
    );
  });

  // ---- I. vendored +json media types ----------------------------------------

  it('hoists and marshals vendored +json request/response schemas', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/v': {
          post: {
            operationId: 'postV',
            requestBody: {
              required: true,
              content: {
                'application/vnd.api+json': {
                  schema: {
                    type: 'object',
                    properties: {
                      at: { type: 'string', format: 'date-time' },
                    },
                    required: ['at'],
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/vnd.api+json': {
                    schema: {
                      type: 'object',
                      properties: {
                        at: { type: 'string', format: 'date-time' },
                      },
                      required: ['at'],
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: { schemas: {} },
    } as unknown as Spec;
    const { types, client } = await generate(spec);

    // The inline schemas are hoisted to named models with Date properties.
    expect(types).toContain('PostVRequestContent');
    expect(types).toContain('PostV200Response');
    expect(types).toMatch(/at: Date;/);

    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({ at: '2024-01-02T03:04:05.000Z' }),
    });
    const response = await callGeneratedClient(client, mockFetch, 'postV', {
      at: new Date('2024-01-02T03:04:05.000Z'),
    });
    expect(response).toEqual({ at: new Date('2024-01-02T03:04:05.000Z') });
    const [, request] = mockFetch.mock.calls[0];
    expect(JSON.parse(request.body)).toEqual({
      at: '2024-01-02T03:04:05.000Z',
    });
    expect(request.headers).toContainEqual([
      'Content-Type',
      'application/vnd.api+json',
    ]);
  });

  // ---- J. rewrites nested inside rewritten schemas ---------------------------

  it('renders a multi-type union for items of a nullable (multi-type) array', async () => {
    const spec = {
      openapi: '3.1.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/r': {
          get: {
            operationId: 'getThing',
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Thing' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Thing: {
            type: 'object',
            properties: {
              data: {
                type: ['array', 'null'],
                items: { type: ['integer', 'string'] },
              },
            },
          },
        },
      },
    } as unknown as Spec;
    const { types } = await generate(spec);

    expect(types).toMatch(/number \| string/);
  });

  it('rewrites a const declared inside a nullable (multi-type) object', async () => {
    const spec = {
      openapi: '3.1.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/r': {
          get: {
            operationId: 'getThing',
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Thing' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Thing: {
            type: 'object',
            properties: {
              wrapper: {
                type: ['object', 'null'],
                properties: {
                  kind: { type: 'string', const: 'fixed' },
                },
              },
            },
          },
        },
      },
    } as unknown as Spec;
    const { types } = await generate(spec);

    expect(types).toContain("'fixed'");
  });

  // ---- K. query + header array params sharing a name ------------------------

  it('keeps separate collection-format maps for same-named query and header arrays', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/items': {
          get: {
            operationId: 'listItems',
            parameters: [
              {
                name: 'ids',
                in: 'query',
                schema: { type: 'array', items: { type: 'string' } },
                explode: false,
              },
              {
                name: 'ids',
                in: 'header',
                schema: { type: 'array', items: { type: 'string' } },
                explode: true,
              },
            ],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
      components: { schemas: {} },
    } as unknown as Spec;
    const { client } = await generate(spec);

    // The two 'ids' params live in separate collection-format maps.
    expect(client).toContain('queryCollectionFormats');
    expect(client).toContain('headerCollectionFormats');

    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({ status: 200 });
    await callGeneratedClient(client, mockFetch, 'listItems', {
      ids: ['a', 'b'],
    });
    const [url, request] = mockFetch.mock.calls[0];
    // Query: csv (explode false); header: multi (explode true, repeated).
    expect(url).toBe(`${baseUrl}/items?ids=a%2Cb`);
    expect(request.headers).toEqual([
      ['ids', 'a'],
      ['ids', 'b'],
    ]);
  });

  // ---- L. spaceDelimited / pipeDelimited query arrays -----------------------

  it('serialises spaceDelimited and pipeDelimited query arrays with the right delimiter', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/search': {
          get: {
            operationId: 'search',
            parameters: [
              {
                name: 'spaced',
                in: 'query',
                style: 'spaceDelimited',
                explode: false,
                schema: { type: 'array', items: { type: 'string' } },
              },
              {
                name: 'piped',
                in: 'query',
                style: 'pipeDelimited',
                explode: false,
                schema: { type: 'array', items: { type: 'string' } },
              },
            ],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
      components: { schemas: {} },
    } as unknown as Spec;
    const { client } = await generate(spec);

    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({ status: 200 });
    await callGeneratedClient(client, mockFetch, 'search', {
      spaced: ['a', 'b', 'c'],
      piped: ['x', 'y'],
    });
    const [url] = mockFetch.mock.calls[0];
    // %20 = space, %7C = pipe
    expect(url).toBe(`${baseUrl}/search?spaced=a%20b%20c&piped=x%7Cy`);
  });

  // ---- M. discriminated oneOf marshalling -----------------------------------

  const discriminatedShapeSpec = (withMapping: boolean): Spec =>
    ({
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/shapes': {
          post: {
            operationId: 'postShape',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Shape' },
                },
              },
            },
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Shape' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Cat: {
            type: 'object',
            required: ['kind', 'napAt'],
            properties: {
              kind: { type: 'string' },
              napAt: { type: 'string', format: 'date-time' },
            },
          },
          Dog: {
            type: 'object',
            required: ['kind', 'walkAt'],
            properties: {
              kind: { type: 'string' },
              walkAt: { type: 'string', format: 'date-time' },
            },
          },
          Shape: {
            oneOf: [
              { $ref: '#/components/schemas/Cat' },
              { $ref: '#/components/schemas/Dog' },
            ],
            discriminator: {
              propertyName: 'kind',
              ...(withMapping
                ? {
                    mapping: {
                      cat: '#/components/schemas/Cat',
                      dog: '#/components/schemas/Dog',
                    },
                  }
                : {}),
            },
          },
        },
      },
    }) as unknown as Spec;

  it('marshals a discriminated oneOf to the matching branch (explicit mapping)', async () => {
    const { types, client } = await generate(discriminatedShapeSpec(true));

    // The union is tagged: each branch's discriminator is its literal, so it
    // narrows on `kind`.
    expect(types).toMatch(/kind:\s*'cat'/);
    expect(types).toMatch(/kind:\s*'dog'/);

    // fromJson dispatches on the wire discriminator and picks a single branch.
    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi
        .fn()
        .mockResolvedValue({ kind: 'dog', walkAt: '2024-01-02T03:04:05.000Z' }),
    });
    const response = await callGeneratedClient(client, mockFetch, 'postShape', {
      kind: 'dog',
      walkAt: new Date('2024-01-02T03:04:05.000Z'),
    });
    // The Cat branch's napAt must not leak onto the Dog result.
    expect(response).toEqual({
      kind: 'dog',
      walkAt: new Date('2024-01-02T03:04:05.000Z'),
    });
    expect('napAt' in response).toBe(false);
    // The request body is marshalled via the Dog branch only.
    const [, request] = mockFetch.mock.calls[0];
    expect(JSON.parse(request.body)).toEqual({
      kind: 'dog',
      walkAt: '2024-01-02T03:04:05.000Z',
    });
  });

  it('marshals a discriminated oneOf using implicit (schema-name) mapping', async () => {
    const { client } = await generate(discriminatedShapeSpec(false));

    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi
        .fn()
        .mockResolvedValue({ kind: 'Dog', walkAt: '2024-01-02T03:04:05.000Z' }),
    });
    const response = await callGeneratedClient(client, mockFetch, 'postShape', {
      kind: 'Dog',
      walkAt: new Date('2024-01-02T03:04:05.000Z'),
    });
    expect(response).toEqual({
      kind: 'Dog',
      walkAt: new Date('2024-01-02T03:04:05.000Z'),
    });
    expect('napAt' in response).toBe(false);
  });

  it('does not build a discriminator switch for inline (hoisted) union members', async () => {
    // Inline oneOf members are hoisted to synthetic names (ShapeOneOf, …) that
    // can never appear on the wire, so an implicit discriminator must not emit
    // dispatch cases on them; marshalling falls through to the merge.
    const spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/shapes': {
          get: {
            operationId: 'getShape',
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Shape' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Shape: {
            oneOf: [
              {
                type: 'object',
                required: ['kind', 'napAt'],
                properties: {
                  kind: { type: 'string' },
                  napAt: { type: 'string', format: 'date-time' },
                },
              },
              {
                type: 'object',
                required: ['kind', 'walkAt'],
                properties: {
                  kind: { type: 'string' },
                  walkAt: { type: 'string', format: 'date-time' },
                },
              },
            ],
            discriminator: { propertyName: 'kind' },
          },
        },
      },
    } as unknown as Spec;
    const { client } = await generate(spec);

    // No dispatch on synthetic hoisted names.
    expect(client).not.toContain("case 'ShapeOneOf'");
    expect(client).not.toMatch(/switch \(json\?\.\['kind'\]\)/);

    // Still deserialises without crashing (merge fallthrough).
    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi
        .fn()
        .mockResolvedValue({ kind: 'dog', walkAt: '2024-01-02T03:04:05.000Z' }),
    });
    const response = await callGeneratedClient(client, mockFetch, 'getShape');
    expect(response.walkAt).toEqual(new Date('2024-01-02T03:04:05.000Z'));
  });

  it('dispatches a discriminator whose wire name differs from its TS name', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/shapes': {
          post: {
            operationId: 'postShape',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Shape' },
                },
              },
            },
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Shape' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Cat: {
            type: 'object',
            required: ['pet-type', 'napAt'],
            properties: {
              'pet-type': { type: 'string' },
              napAt: { type: 'string', format: 'date-time' },
            },
          },
          Dog: {
            type: 'object',
            required: ['pet-type', 'walkAt'],
            properties: {
              'pet-type': { type: 'string' },
              walkAt: { type: 'string', format: 'date-time' },
            },
          },
          Shape: {
            oneOf: [
              { $ref: '#/components/schemas/Cat' },
              { $ref: '#/components/schemas/Dog' },
            ],
            discriminator: {
              propertyName: 'pet-type',
              mapping: {
                cat: '#/components/schemas/Cat',
                dog: '#/components/schemas/Dog',
              },
            },
          },
        },
      },
    } as unknown as Spec;
    const { client } = await generate(spec);

    // toJson dispatches on the TS name, fromJson on the wire name.
    expect(client).toContain('switch ((model as any).petType)');
    expect(client).toContain("switch (json?.['pet-type'])");

    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        'pet-type': 'dog',
        walkAt: '2024-01-02T03:04:05.000Z',
      }),
    });
    const response = await callGeneratedClient(client, mockFetch, 'postShape', {
      petType: 'dog',
      walkAt: new Date('2024-01-02T03:04:05.000Z'),
    } as never);
    expect('napAt' in response).toBe(false);
    // The request body carries the wire discriminator name.
    const [, request] = mockFetch.mock.calls[0];
    expect(JSON.parse(request.body)).toEqual({
      'pet-type': 'dog',
      walkAt: '2024-01-02T03:04:05.000Z',
    });
  });

  // ---- O. deepObject query parameters ---------------------------------------

  it('serialises a deepObject query parameter as key[prop]=value pairs', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/search': {
          get: {
            operationId: 'search',
            parameters: [
              {
                name: 'filter',
                in: 'query',
                style: 'deepObject',
                explode: true,
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    min: { type: 'integer' },
                    since: { type: 'string', format: 'date-time' },
                  },
                },
              },
            ],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
      components: { schemas: {} },
    } as unknown as Spec;
    const { types, client } = await generate(spec);

    // The inline object param is hoisted to a named model, so its members
    // (including the Date) are fully typed and marshalled.
    expect(types).toContain('SearchRequestQueryFilter');

    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({ status: 200 });
    await callGeneratedClient(client, mockFetch, 'search', {
      filter: {
        name: 'bob',
        min: 3,
        since: new Date('2024-01-02T03:04:05.000Z'),
      },
    });
    const [url] = mockFetch.mock.calls[0];
    // Each property becomes its own bracketed query pair; the nested Date is
    // marshalled to an ISO string. Brackets are not percent-encoded (matches
    // the deepObject convention servers expect).
    expect(url).toBe(
      `${baseUrl}/search?filter[name]=bob&filter[min]=3&filter[since]=2024-01-02T03%3A04%3A05.000Z`,
    );
  });

  it('omits undefined and null members of a deepObject query parameter', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/search': {
          get: {
            operationId: 'search',
            parameters: [
              {
                name: 'filter',
                in: 'query',
                style: 'deepObject',
                explode: true,
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    tag: { type: 'string', nullable: true },
                  },
                },
              },
            ],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
      components: { schemas: {} },
    } as unknown as Spec;
    const { client } = await generate(spec);

    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({ status: 200 });
    await callGeneratedClient(client, mockFetch, 'search', {
      filter: { name: 'bob', tag: null },
    });
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(`${baseUrl}/search?filter[name]=bob`);
  });

  it('recurses into a nested deepObject query parameter', async () => {
    const spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/search': {
          get: {
            operationId: 'search',
            parameters: [
              {
                name: 'filter',
                in: 'query',
                style: 'deepObject',
                explode: true,
                schema: {
                  type: 'object',
                  properties: {
                    page: {
                      type: 'object',
                      properties: {
                        size: { type: 'integer' },
                        sort: { type: 'string' },
                      },
                    },
                  },
                },
              },
            ],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
      components: { schemas: {} },
    } as unknown as Spec;
    const { client } = await generate(spec);

    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({ status: 200 });
    await callGeneratedClient(client, mockFetch, 'search', {
      filter: { page: { size: 10, sort: 'asc' } },
    });
    const [url] = mockFetch.mock.calls[0];
    // Nested objects recurse to `filter[page][size]=…`, not `[object Object]`.
    expect(url).toBe(
      `${baseUrl}/search?filter[page][size]=10&filter[page][sort]=asc`,
    );
  });

  // ---- P. tagged discriminated union narrows -------------------------------

  it('emits a tagged union that narrows on the discriminator', async () => {
    const { types } = await generate(discriminatedShapeSpec(true));

    // Each branch's discriminator is typed as its literal.
    expect(types).toMatch(/kind:\s*'cat'/);
    expect(types).toMatch(/kind:\s*'dog'/);

    // A consumer that narrows on the discriminator must type-check: accessing a
    // branch-only field after checking `kind` is only valid for a tagged union.
    tree.write(
      'src/generated/consumer.ts',
      `import type { Shape } from './types.gen';
       export const napAt = (shape: Shape): Date | undefined => {
         switch (shape.kind) {
           case 'cat':
             return shape.napAt;
           case 'dog':
             return shape.walkAt;
         }
       };`,
    );
    expectTypeScriptToCompile(tree, [
      'src/generated/types.gen.ts',
      'src/generated/consumer.ts',
    ]);
  });

  it('uses the original schema name as the discriminator value for normalised names', async () => {
    // Implicit discriminator over subtypes whose names need normalisation
    // (`pet-cat` -> `PetCat`). The discriminator value on the wire is the
    // ORIGINAL name, so both the type literal and the runtime dispatch must use
    // `pet-cat`, not the normalised `PetCat`.
    const spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/pets': {
          get: {
            operationId: 'getPet',
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Pet' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          'pet-cat': {
            type: 'object',
            required: ['kind', 'napAt'],
            properties: {
              kind: { type: 'string' },
              napAt: { type: 'string', format: 'date-time' },
            },
          },
          'pet-dog': {
            type: 'object',
            required: ['kind', 'walkAt'],
            properties: {
              kind: { type: 'string' },
              walkAt: { type: 'string', format: 'date-time' },
            },
          },
          Pet: {
            oneOf: [
              { $ref: '#/components/schemas/pet-cat' },
              { $ref: '#/components/schemas/pet-dog' },
            ],
            discriminator: { propertyName: 'kind' },
          },
        },
      },
    } as unknown as Spec;
    const { types, client } = await generate(spec);

    // Literal tag and dispatch both use the original wire name.
    expect(types).toMatch(/kind:\s*'pet-cat'/);
    expect(client).toContain("case 'pet-cat'");
    expect(types).not.toMatch(/kind:\s*'PetCat'/);

    // A `pet-cat` payload dispatches to the PetCat branch and revives its date.
    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        kind: 'pet-cat',
        napAt: '2024-01-02T03:04:05.000Z',
      }),
    });
    const response = await callGeneratedClient(client, mockFetch, 'getPet');
    expect(response).toEqual({
      kind: 'pet-cat',
      napAt: new Date('2024-01-02T03:04:05.000Z'),
    });
    expect('walkAt' in response).toBe(false);
  });
});
