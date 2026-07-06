/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { expectTypeScriptToCompile } from '../../utils/test/ts.spec';
import type { Spec } from '../utils/types';
import { openApiTsClientGenerator } from './generator';

/**
 * Regression coverage for parser defects surfaced by differentially testing a
 * wide corpus of real-world specs (FastAPI / Smithy / raw OpenAPI) against the
 * generator output:
 *  A. boolean/number enums must render as their bare primitive, not `string`
 *  B. multi-type schemas (`type: ['integer', 'string']`) must render a union
 *  C. path-level (shared) parameters must be inherited by every operation
 *  D. `requestBody.description` must render as the body param's doc comment
 */
describe('openApiTsClientGenerator - regressions', () => {
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
    return tree.read('src/generated/types.gen.ts', 'utf-8')!;
  };

  const responseSchema = (schema: unknown): Spec => ({
    openapi: '3.0.3',
    info: { title, version: '1.0.0' },
    paths: {
      '/r': {
        get: {
          operationId: 'getThing',
          responses: {
            '200': {
              description: 'ok',
              content: { 'application/json': { schema: schema as never } },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Thing: {
          type: 'object',
          properties: schema as never,
        },
      },
    },
  });

  // ---- A. boolean & numeric enums ----------------------------------------

  it('renders a boolean enum as `boolean`, not `string`', async () => {
    const types = await generate(
      responseSchema({
        flagTrue: { type: 'boolean', enum: [true] },
        flagFalse: { type: 'boolean', enum: [false] },
        flagBoth: { type: 'boolean', enum: [true, false] },
      }),
    );
    expect(types).toMatch(/flagTrue\?: boolean;/);
    expect(types).toMatch(/flagFalse\?: boolean;/);
    expect(types).toMatch(/flagBoth\?: boolean;/);
    expect(types).not.toMatch(/flag\w+\?: string;/);
  });

  it('renders an integer enum as `number`, not `string`', async () => {
    const types = await generate(
      responseSchema({
        code: { type: 'integer', enum: [1, 2, 3] },
        ratio: { type: 'number', enum: [1.5, 2.5] },
      }),
    );
    expect(types).toMatch(/code\?: number;/);
    expect(types).toMatch(/ratio\?: number;/);
  });

  it('still renders a string enum as a literal union', async () => {
    const types = await generate(
      responseSchema({
        status: { type: 'string', enum: ['a', 'b'] },
      }),
    );
    expect(types).toMatch(/'a'/);
    expect(types).toMatch(/'b'/);
  });

  // ---- B. multi-type schemas ---------------------------------------------

  it('renders a multi-type schema as a union of all its types', async () => {
    const types = await generate(
      responseSchema({
        both: { type: ['integer', 'string'] },
        three: { type: ['integer', 'string', 'boolean'] },
      }),
    );
    expect(types).toMatch(/number \| string/);
    expect(types).toMatch(/number \| string \| boolean/);
  });

  it('renders a multi-type array item as a union', async () => {
    const types = await generate(
      responseSchema({
        items: { type: 'array', items: { type: ['number', 'string'] } },
      }),
    );
    expect(types).toMatch(/number \| string/);
    expect(types).toMatch(/Array<\w+>/);
  });

  it('treats `[T, null]` as nullable `T`, not a union', async () => {
    const types = await generate(
      responseSchema({
        maybe: { type: ['string', 'null'] },
      }),
    );
    expect(types).toMatch(/maybe\?: string \| null;/);
  });

  // ---- C. path-level (shared) parameters ---------------------------------

  it('inherits path-level parameters into each operation', async () => {
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/things': {
          parameters: [
            {
              name: 'X-Tenant-Id',
              in: 'header',
              required: true,
              schema: { type: 'string' },
            },
          ],
          get: {
            operationId: 'listThings',
            parameters: [
              { name: 'limit', in: 'query', schema: { type: 'integer' } },
            ],
            responses: {
              '200': {
                description: 'ok',
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
    };
    const types = await generate(spec);
    // The required path-level header must appear on the request type.
    expect(types).toMatch(/xTenantId: string;/);
    expect(types).toMatch(/limit\?: number;/);
    const client = tree.read('src/generated/client.gen.ts', 'utf-8')!;
    expect(client).toContain("'X-Tenant-Id'");
  });

  it('lets an operation-level parameter override a path-level one', async () => {
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/things': {
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'string' } },
          ],
          get: {
            operationId: 'listThings',
            parameters: [
              {
                name: 'limit',
                in: 'query',
                required: true,
                schema: { type: 'integer' },
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
    const types = await generate(spec);
    // Operation-level `limit: integer` (required) wins over path-level string.
    expect(types).toMatch(/limit: number;/);
    expect(types).not.toMatch(/limit\??: string;/);
  });

  // ---- E. nested-array marshalling (noImplicitAny) -----------------------

  it('compiles nested arrays of dates/models (annotates inner map params)', async () => {
    // The nested `.map()` marshalling helpers used to leave the inner lambda
    // parameter untyped, tripping noImplicitAny for arrays-of-arrays whose leaf
    // needs conversion (dates, models, primitive unions).
    const spec: Spec = {
      openapi: '3.1.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/r': {
          post: {
            operationId: 'postNested',
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Nested' },
                },
              },
            },
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Nested' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Leaf: {
            type: 'object',
            properties: { id: { type: 'string' } },
          },
          Nested: {
            type: 'object',
            properties: {
              dates2d: {
                type: 'array',
                items: {
                  type: 'array',
                  items: { type: 'string', format: 'date-time' },
                },
              },
              models2d: {
                type: 'array',
                items: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Leaf' },
                },
              },
              unions2d: {
                type: 'array',
                items: {
                  type: 'array',
                  items: { type: ['integer', 'string'] },
                },
              },
            },
          },
        },
      },
    };
    // Must compile under strict/noImplicitAny (the assertion is in generate()).
    await generate(spec);
  });

  // ---- D. requestBody description ----------------------------------------

  it('renders requestBody.description as the body parameter doc comment', async () => {
    // When the body cannot be inlined (here its `id` property clashes with the
    // path param `id`), it gets a dedicated `...RequestBodyParameters` wrapper
    // whose doc comment must carry the requestBody description — the petstore
    // `updateUser` shape (its `User` body has a `username` clashing with the
    // `username` path param).
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/things/{id}': {
          put: {
            operationId: 'updateThing',
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            requestBody: {
              description: 'The thing to update',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Thing' },
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
      components: {
        schemas: {
          Thing: {
            type: 'object',
            properties: { id: { type: 'string' }, name: { type: 'string' } },
          },
        },
      },
    };
    const types = await generate(spec);
    expect(types).toContain('The thing to update');
  });

  // ---- F. operations whose only responses are errors (no result) ---------

  it('compiles an operation whose only response is an error code', async () => {
    // `op.result` is undefined when no 2XX/default response exists; the client
    // template used to read `op.result.typescriptType` unconditionally and crash.
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/thing': {
          post: {
            operationId: 'createThing',
            responses: {
              '403': {
                description: 'forbidden',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { message: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    // Generation must not throw and must compile (result type is `void`).
    const types = await generate(spec);
    expect(types).toContain('CreateThingError');
  });

  // ---- G. identifiers from non-identifier characters ---------------------

  it('sanitizes non-ASCII operationIds into valid identifiers', async () => {
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/thing': {
          get: {
            // The `≠` (and accented chars) must not leak into TS identifiers.
            operationId: 'getThing≠Café',
            parameters: [
              { name: 'q', in: 'query', schema: { type: 'string' } },
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
    const types = await generate(spec);
    expect(types).not.toMatch(/[^\x00-\x7F]/); // no non-ASCII in output
    const client = tree.read('src/generated/client.gen.ts', 'utf-8')!;
    expect(client).not.toMatch(/[^\x00-\x7F]/);
  });

  it('handles a property named entirely of non-identifier characters', async () => {
    // A property named "_" camelCases to an empty string; it must still emit a
    // valid identifier rather than `model.` / an empty key.
    const types = await generate(
      responseSchema({
        _: { type: 'object', additionalProperties: { type: 'string' } },
      }),
    );
    expect(types).toBeDefined();
  });

  // ---- H. dictionary (map) response body ---------------------------------

  it('compiles an operation returning a bare dictionary', async () => {
    // A map response emits `$IO.$mapValues(...)` inside the client class, which
    // requires `$mapValues` to be accessible (not `protected`).
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/things': {
          get: {
            operationId: 'getThings',
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      additionalProperties: {
                        type: 'object',
                        properties: { name: { type: 'string' } },
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
    // Must compile — cross-class `$IO.$mapValues` access.
    await generate(spec);
  });

  // ---- I. hoisted inline schema names with `_`-separated property names ---

  it('resolves hoisted inline schema names for snake_case properties', async () => {
    // `store_photos` hoists to a schema whose name must match its references
    // (both normalised, so `StorePhotos` not `Store_photos`).
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title, version: '1.0.0' },
      paths: {
        '/search': {
          get: {
            operationId: 'search',
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        store_photos: {
                          type: 'object',
                          additionalProperties: {
                            type: 'object',
                            properties: { url: { type: 'string' } },
                          },
                        },
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
    // Must compile — the hoisted schema name and its reference must agree.
    await generate(spec);
  });
});
