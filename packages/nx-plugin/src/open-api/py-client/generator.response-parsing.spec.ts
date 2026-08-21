/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { PythonVerifier } from '../../utils/test/py.spec';
import type { Spec } from '../utils/types';
import {
  callGeneratedClient,
  callGeneratedClientAsync,
  createTree,
  generateAndRead,
} from './generator.utils.spec';

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
  let verifier: PythonVerifier;

  beforeAll(() => {
    verifier = new PythonVerifier();
  });

  afterAll(async () => {
    await verifier.shutdown();
  });

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
});
