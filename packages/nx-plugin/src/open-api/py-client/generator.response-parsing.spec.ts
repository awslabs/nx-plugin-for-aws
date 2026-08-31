/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import type { Spec } from '../utils/types.js';
import { openApiPyClientGenerator } from './generator.js';
import {
  callGeneratedClient,
  callGeneratedClientAsync,
  createPythonClientVerifier,
  createTree,
  generateAndRead,
  outputPath,
  requestJsonBody,
} from './generator.utils.spec.js';

/**
 * What each response shape deserialises to, invoked rather than snapshotted: a
 * value of the wrong Python type (a float where the spec says integer, a merged
 * union branch, a JSON-decoded text body) only shows up when the method runs.
 */
const jsonResponse = (schema: unknown) => ({
  '200': {
    description: 'OK',
    content: { 'application/json': { schema } },
  },
});

const textResponse = (schema: unknown) => ({
  '200': {
    description: 'OK',
    content: { 'text/plain': { schema } },
  },
});

const spec: Spec = {
  openapi: '3.0.3',
  info: { title: 'RespApi', version: '1.0.0' },
  paths: {
    '/int': {
      get: {
        operationId: 'getInt',
        responses: jsonResponse({ type: 'integer' }),
      },
    },
    '/float': {
      get: {
        operationId: 'getFloat',
        responses: jsonResponse({ type: 'number' }),
      },
    },
    '/bool': {
      get: {
        operationId: 'getBool',
        responses: jsonResponse({ type: 'boolean' }),
      },
    },
    '/str': {
      get: {
        operationId: 'getStr',
        responses: jsonResponse({ type: 'string' }),
      },
    },
    '/date': {
      get: {
        operationId: 'getDate',
        responses: jsonResponse({ type: 'string', format: 'date' }),
      },
    },
    '/ints': {
      get: {
        operationId: 'getInts',
        responses: jsonResponse({ type: 'array', items: { type: 'integer' } }),
      },
    },
    '/bools': {
      get: {
        operationId: 'getBools',
        responses: jsonResponse({ type: 'array', items: { type: 'boolean' } }),
      },
    },
    '/nested': {
      get: {
        operationId: 'getNested',
        responses: jsonResponse({
          type: 'array',
          items: { type: 'array', items: { type: 'integer' } },
        }),
      },
    },
    '/counts': {
      get: {
        operationId: 'getCounts',
        responses: jsonResponse({
          type: 'object',
          additionalProperties: { type: 'integer' },
        }),
      },
    },
    '/nullable-str': {
      get: {
        operationId: 'getNullableStr',
        responses: jsonResponse({ type: 'string', nullable: true }),
      },
    },
    '/nullable-list': {
      get: {
        operationId: 'getNullableList',
        responses: jsonResponse({
          type: 'array',
          items: { type: 'string' },
          nullable: true,
        }),
      },
    },
    '/text-int': {
      get: {
        operationId: 'getTextInt',
        responses: textResponse({ type: 'integer' }),
      },
    },
    '/text-bool': {
      get: {
        operationId: 'getTextBool',
        responses: textResponse({ type: 'boolean' }),
      },
    },
    '/text-str': {
      get: {
        operationId: 'getTextStr',
        responses: textResponse({ type: 'string' }),
      },
    },
    '/text-any': {
      get: { operationId: 'getTextAny', responses: textResponse({}) },
    },
    '/text-enum': {
      get: {
        operationId: 'getTextEnum',
        responses: textResponse({ $ref: '#/components/schemas/Colour' }),
      },
    },
    '/vendor-json': {
      get: {
        operationId: 'getVendorJson',
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/vnd.api+json; charset=utf-8': {
                schema: { type: 'string' },
              },
            },
          },
        },
      },
    },
    '/enum': {
      get: {
        operationId: 'getEnum',
        responses: jsonResponse({ $ref: '#/components/schemas/Colour' }),
      },
    },
    '/model': {
      get: {
        operationId: 'getModel',
        responses: jsonResponse({ $ref: '#/components/schemas/Thing' }),
      },
    },
  },
  components: {
    schemas: {
      Colour: { type: 'string', enum: ['red', 'green'] },
      Thing: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' } },
      },
    },
  },
};

describe('openApiPyClientGenerator - response parsing', () => {
  let tree: Tree;
  const verifier = createPythonClientVerifier();

  beforeEach(async () => {
    tree = createTree();
    await generateAndRead(verifier, tree, spec);
  });

  // `pyTypeOf` is asserted because a float where the spec declares an integer
  // is still JSON-equal to it, and would pass a value-only comparison.
  it.each([
    ['get_int', { json: 7 }, 7, 'int'],
    ['get_float', { json: 7 }, 7, 'float'],
    ['get_bool', { json: true }, true, 'bool'],
    ['get_str', { json: 'hello' }, 'hello', 'str'],
    ['get_ints', { json: [1, 2] }, [1, 2], 'list'],
    ['get_bools', { json: [true, false] }, [true, false], 'list'],
    ['get_nested', { json: [[1], [2, 3]] }, [[1], [2, 3]], 'list'],
    ['get_counts', { json: { a: 1 } }, { a: 1 }, 'dict'],
    ['get_enum', { json: 'red' }, 'red', 'str'],
  ] as const)(
    'parses %s as the declared type',
    async (method, mock, value, pyType) => {
      const res = await callGeneratedClient(verifier, method, {}, mock);
      expect(res.ok).toBe(true);
      expect(res.value).toEqual(value);
      expect(res.pyType).toBe(pyType);
    },
  );

  it('parses an integer array element-wise, not as one float', async () => {
    const res = await callGeneratedClient(
      verifier,
      'get_ints',
      {},
      { json: [1, 2] },
    );
    expect(res.pyElementTypes).toEqual(['int', 'int']);
  });

  it('revives a date-formatted response', async () => {
    const res = await callGeneratedClient(
      verifier,
      'get_date',
      {},
      { json: '2026-04-18' },
    );
    expect(res.ok).toBe(true);
    // A `date` rather than the raw string the wire carried.
    expect(res.pyType).toBe('date');
    expect(res.value).toBe('datetime.date(2026, 4, 18)');
  });

  it('parses a model response into its pydantic class', async () => {
    const res = await callGeneratedClient(
      verifier,
      'get_model',
      {},
      { json: { name: 'x' } },
    );
    expect(res.ok).toBe(true);
    expect(res.pyType).toBe('Thing');
    expect(res.value).toMatchObject({ name: 'x' });
  });

  // A nullable body may arrive as JSON null, which a non-Optional annotation
  // would reject at validation time.
  it.each([
    ['get_nullable_str', 'x'],
    ['get_nullable_list', ['x']],
  ] as const)(
    'accepts a null body for nullable %s',
    async (method, present) => {
      const nullRes = await callGeneratedClient(
        verifier,
        method,
        {},
        { json: null },
      );
      expect(nullRes.ok).toBe(true);
      expect(nullRes.value).toBeNull();
      const valueRes = await callGeneratedClient(
        verifier,
        method,
        {},
        { json: present },
      );
      expect(valueRes.value).toEqual(present);
    },
  );

  // A non-JSON body is read as text and coerced; `response.json()` would raise.
  it.each([
    ['get_text_int', '7', 7, 'int'],
    ['get_text_bool', 'true', true, 'bool'],
    ['get_text_str', 'plain words', 'plain words', 'str'],
    ['get_text_any', 'not json at all', 'not json at all', 'str'],
    ['get_text_enum', 'green', 'green', 'str'],
  ] as const)(
    'reads %s from a text/plain body',
    async (method, text, value, pyType) => {
      const res = await callGeneratedClient(verifier, method, {}, { text });
      expect(res.ok).toBe(true);
      expect(res.value).toEqual(value);
      expect(res.pyType).toBe(pyType);
    },
  );

  // A `+json` suffix with parameters is still JSON on the wire, so a string
  // body arrives quoted and must be JSON-parsed rather than read as text.
  it('JSON-parses a +json media type carrying parameters', async () => {
    const res = await callGeneratedClient(
      verifier,
      'get_vendor_json',
      {},
      {
        text: '"quoted"',
        headers: { 'content-type': 'application/vnd.api+json; charset=utf-8' },
      },
    );
    expect(res.ok).toBe(true);
    expect(res.value).toBe('quoted');
  });

  it('parses the same shapes through the async client', async () => {
    const res = await callGeneratedClientAsync(
      verifier,
      'get_int',
      {},
      { json: 7 },
    );
    expect(res.ok).toBe(true);
    expect(res.pyType).toBe('int');
    const texted = await callGeneratedClientAsync(
      verifier,
      'get_text_int',
      {},
      { text: '7' },
    );
    expect(texted.pyType).toBe('int');
  });

  // A response body the spec marks nullable may arrive as JSON `null`. Parsing
  // it as the declared class would raise a pydantic ValidationError.
  describe('nullable response bodies', () => {
    const nullableSpec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/maybe': {
          get: {
            operationId: 'getMaybe',
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      nullable: true,
                      required: ['a'],
                      properties: { a: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    it('returns None for a null object body', async () => {
      await generateAndRead(verifier, tree, nullableSpec);
      const res = await callGeneratedClient(
        verifier,
        'get_maybe',
        {},
        {
          json: null,
        },
      );
      expect(res.ok).toBe(true);
      expect(res.value).toBeNull();
    });

    it('still parses a present object body', async () => {
      await generateAndRead(verifier, tree, nullableSpec);
      const res = await callGeneratedClient(
        verifier,
        'get_maybe',
        {},
        {
          json: { a: 'hi' },
        },
      );
      expect(res.ok).toBe(true);
      expect(res.value).toEqual({ a: 'hi' });
    });
  });

  // A response declaring JSON alongside another media type can arrive as either,
  // and a declared-JSON body can arrive empty. Both raised a bare
  // `json.JSONDecodeError` out of the client.
  describe('bodies that are not the JSON the spec declares', () => {
    const multiMediaSpec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/either': {
          get: {
            operationId: 'getEither',
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': { schema: { type: 'string' } },
                  'text/plain': { schema: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    };

    it('reads a text body on a response also declaring JSON', async () => {
      await generateAndRead(verifier, tree, multiMediaSpec);
      const res = await callGeneratedClient(
        verifier,
        'get_either',
        {},
        {
          text: 'not json at all',
          headers: { 'content-type': 'text/plain' },
        },
      );
      expect(res.ok).toBe(true);
      expect(res.value).toBe('not json at all');
    });

    it('returns None for an empty body', async () => {
      await generateAndRead(verifier, tree, multiMediaSpec);
      const res = await callGeneratedClient(
        verifier,
        'get_either',
        {},
        {
          status: 200,
        },
      );
      expect(res.ok).toBe(true);
      expect(res.value).toBeNull();
    });
  });

  // A binary response is handed over as bytes, and a unicode body must survive
  // the round trip rather than being mangled by an encoding assumption.
  describe('binary and unicode bodies', () => {
    it('returns a binary response as bytes', async () => {
      await generateAndRead(verifier, tree, {
        openapi: '3.0.0',
        info: { title: 'TestApi', version: '1.0.0' },
        paths: {
          '/blob': {
            get: {
              operationId: 'getBlob',
              responses: {
                '200': {
                  description: 'OK',
                  content: {
                    'application/octet-stream': {
                      schema: { type: 'string', format: 'binary' },
                    },
                  },
                },
              },
            },
          },
        },
      });
      const res = await callGeneratedClient(
        verifier,
        'get_blob',
        {},
        {
          // "hello" as raw bytes, so nothing can decode it into a str by accident.
          bytes_b64: Buffer.from('hello').toString('base64'),
          headers: { 'content-type': 'application/octet-stream' },
        },
      );
      expect(res.ok).toBe(true);
      expect(res.pyType).toBe('bytes');
    });

    it('round-trips a unicode body', async () => {
      await generateAndRead(verifier, tree, {
        openapi: '3.0.0',
        info: { title: 'TestApi', version: '1.0.0' },
        paths: {
          '/echo': {
            post: {
              operationId: 'echo',
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['text'],
                      properties: { text: { type: 'string' } },
                    },
                  },
                },
              },
              responses: {
                '200': {
                  description: 'OK',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        required: ['text'],
                        properties: { text: { type: 'string' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
      const text = 'ペット — 🐈 café';
      const res = await callGeneratedClient(
        verifier,
        'echo',
        { text },
        { json: { text } },
      );
      expect(res.ok).toBe(true);
      expect(res.value).toEqual({ text });
      expect(requestJsonBody(res)).toEqual({ text });
    });
  });

  /**
   * The 3.1 spelling of an optional response. FastAPI emits
   * `anyOf: [X, {type: 'null'}]` for `Optional[X]`, and `null` was counted as an
   * indistinguishable composed primitive — so generation failed outright on an
   * idiomatic optional response. `null` is precisely the one primitive a runtime
   * CAN tell apart.
   */
  describe('OpenAPI 3.1 optional responses', () => {
    const optionalSpec = (schema: unknown): Spec =>
      ({
        openapi: '3.1.0',
        info: { title: 'TestApi', version: '1.0.0' },
        paths: {
          '/maybe': {
            get: {
              operationId: 'getMaybe',
              responses: {
                '200': {
                  description: 'OK',
                  content: { 'application/json': { schema } },
                },
              },
            },
          },
        },
        components: {
          schemas: {
            Order: {
              type: 'object',
              required: ['id'],
              properties: { id: { type: 'string' } },
            },
          },
        },
      }) as unknown as Spec;

    const NULLABLE_SHAPES: Array<[string, unknown]> = [
      [
        'anyOf with a $ref',
        { anyOf: [{ $ref: '#/components/schemas/Order' }, { type: 'null' }] },
      ],
      [
        'oneOf with a $ref',
        { oneOf: [{ $ref: '#/components/schemas/Order' }, { type: 'null' }] },
      ],
      [
        'a $ref with a nullable sibling',
        { $ref: '#/components/schemas/Order', nullable: true },
      ],
    ];

    it.each(NULLABLE_SHAPES)('returns None for %s', async (_label, schema) => {
      await generateAndRead(verifier, tree, optionalSpec(schema));
      const res = await callGeneratedClient(
        verifier,
        'get_maybe',
        {},
        {
          json: null,
        },
      );
      expect(res.ok).toBe(true);
      expect(res.value).toBeNull();
    });

    it.each(NULLABLE_SHAPES)(
      'still parses a present body for %s',
      async (_label, schema) => {
        await generateAndRead(verifier, tree, optionalSpec(schema));
        const res = await callGeneratedClient(
          verifier,
          'get_maybe',
          {},
          {
            json: { id: 'o1' },
          },
        );
        expect(res.ok).toBe(true);
        expect(res.value).toEqual({ id: 'o1' });
      },
    );
  });

  // Two members of an untagged union declaring an identically-shaped optional
  // property are safe to compose either way, but the normaliser hoists each
  // inline schema to its own name — so keying the check on the name rejected a
  // union whose members convert identically.
  it('accepts an untagged union whose members share an identical property', async () => {
    const { types } = await generateAndRead(verifier, tree, {
      openapi: '3.1.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/c': {
          post: {
            operationId: 'putContact',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Contact' },
                },
              },
            },
            responses: { '204': { description: 'No content' } },
          },
        },
      },
      components: {
        schemas: {
          Contact: {
            anyOf: [
              { $ref: '#/components/schemas/Email' },
              { $ref: '#/components/schemas/Phone' },
            ],
          },
          Email: {
            type: 'object',
            required: ['email'],
            properties: {
              email: { type: 'string' },
              verified_at: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            },
          },
          Phone: {
            type: 'object',
            required: ['phone'],
            properties: {
              phone: { type: 'string' },
              verified_at: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            },
          },
        },
      },
    } as unknown as Spec);
    expect(types).toContain('class Email(BaseModel):');
    expect(types).toContain('class Phone(BaseModel):');
  });

  // A genuine conflict must still be refused: one member converts the property
  // as a date-time, the other leaves it a plain string.
  it('still rejects an untagged union whose members convert a property differently', async () => {
    tree.write(
      'openapi.json',
      JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'TestApi', version: '1.0.0' },
        paths: {
          '/v': {
            post: {
              operationId: 'putV',
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/V' },
                  },
                },
              },
              responses: { '204': { description: 'No content' } },
            },
          },
        },
        components: {
          schemas: {
            V: {
              anyOf: [
                { $ref: '#/components/schemas/A' },
                { $ref: '#/components/schemas/B' },
              ],
            },
            A: {
              type: 'object',
              required: ['when'],
              properties: { when: { type: 'string', format: 'date-time' } },
            },
            B: {
              type: 'object',
              required: ['when'],
              properties: { when: { type: 'string' } },
            },
          },
        },
      }),
    );
    await expect(
      openApiPyClientGenerator(tree, {
        openApiSpecPath: 'openapi.json',
        outputPath,
      }),
    ).rejects.toThrow(/different types/);
  });

  /**
   * Normalisation hoists only the preferred media type's inline schema into
   * `components`, at any depth, so the same shape reaches the conflict check as a
   * `$ref` under one media type and inline under another. Comparing them as
   * written pitted a `$ref` against the schema it was hoisted from and never
   * matched, refusing valid documents — a real spec serving one array of objects
   * as both JSON and XML.
   */
  describe('several media types declaring one schema', () => {
    const twoMediaTypes = (jsonSchema: unknown, xmlSchema: unknown): Spec =>
      ({
        openapi: '3.0.0',
        info: { title: 'TestApi', version: '1.0.0' },
        paths: {
          '/x': {
            get: {
              operationId: 'getX',
              tags: ['t'],
              responses: {
                '200': {
                  description: 'OK',
                  content: {
                    'application/json': { schema: jsonSchema },
                    'application/xml': { schema: xmlSchema },
                  },
                },
              },
            },
          },
        },
      }) as unknown as Spec;

    const itemSchema = {
      type: 'array',
      items: { type: 'object', properties: { a: { type: 'string' } } },
    };

    it('accepts identical schemas hoisted to different depths', async () => {
      const { types } = await generateAndRead(
        verifier,
        tree,
        twoMediaTypes(itemSchema, structuredClone(itemSchema)),
      );
      expect(types).toContain('class GetX200ResponseItem(BaseModel)');
    });

    // A Media Type Object may omit `schema`, which means unconstrained rather
    // than a second, different shape.
    it('accepts a media type that declares no schema', async () => {
      await generateAndRead(
        verifier,
        tree,
        twoMediaTypes(itemSchema, undefined),
      );
    });

    it('still rejects schemas that genuinely differ', async () => {
      await expect(
        generateAndRead(
          verifier,
          tree,
          twoMediaTypes({ type: 'string' }, itemSchema),
        ),
      ).rejects.toThrow(/different schemas per media type/);
    });
  });
});
