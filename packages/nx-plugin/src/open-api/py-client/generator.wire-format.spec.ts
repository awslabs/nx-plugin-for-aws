/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import type { Spec } from '../utils/types';
import {
  callGeneratedClient,
  createPythonClientVerifier,
  createTree,
  expectRequestTarget,
  expectSingleRequest,
  generateAndRead,
  requestQuery,
} from './generator.utils.spec';

/**
 * What the client puts on the wire, asserted against the recorded request
 * rather than the generated source: a serialisation change that a source-text
 * assertion would miss shows up here as a different URL, header or body.
 */
const spec: Spec = {
  openapi: '3.0.3',
  info: { title: 'WireApi', version: '1.0.0' },
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
          {
            name: 'commas',
            in: 'query',
            explode: false,
            schema: { type: 'array', items: { type: 'string' } },
          },
          {
            name: 'repeated',
            in: 'query',
            explode: true,
            schema: { type: 'array', items: { type: 'string' } },
          },
          {
            name: 'on',
            in: 'query',
            schema: { type: 'string', format: 'date' },
          },
          {
            name: 'at',
            in: 'query',
            schema: { type: 'string', format: 'date-time' },
          },
          { name: 'flag', in: 'query', schema: { type: 'boolean' } },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/collide': {
      get: {
        operationId: 'collide',
        parameters: [
          {
            name: 'x',
            in: 'query',
            style: 'pipeDelimited',
            explode: false,
            schema: { type: 'array', items: { type: 'string' } },
          },
          {
            name: 'x',
            in: 'header',
            explode: true,
            schema: { type: 'array', items: { type: 'string' } },
          },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/items/{ids}': {
      get: {
        operationId: 'getItems',
        parameters: [
          {
            name: 'ids',
            in: 'path',
            required: true,
            schema: { type: 'array', items: { type: 'string' } },
          },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/cookied': {
      get: {
        operationId: 'cookied',
        parameters: [
          { name: 'flag', in: 'cookie', schema: { type: 'boolean' } },
          {
            name: 'at',
            in: 'cookie',
            schema: { type: 'string', format: 'date-time' },
          },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { type: 'string' } } },
          },
        },
      },
    },
  },
};

describe('openApiPyClientGenerator - request wire format', () => {
  let tree: Tree;
  const verifier = createPythonClientVerifier();

  beforeEach(async () => {
    tree = createTree();
    await generateAndRead(verifier, tree, spec);
  });

  it('sends the HTTP method and path the spec declares', async () => {
    const res = await callGeneratedClient(
      verifier,
      'get_items',
      { ids: ['a'] },
      {
        json: 'ok',
      },
    );
    expectRequestTarget(res, 'GET', '/items/a');
  });

  // Each style has its own delimiter; without them a server reading a
  // space-delimited parameter sees one value per repeated key instead.
  it.each([
    // httpx form-encodes a space as `+`, which is equivalent to `%20`.
    ['spaced', 'spaced=a+b'],
    ['piped', 'piped=a%7Cb'],
    ['commas', 'commas=a%2Cb'],
  ])(
    'serialises %s array query parameters with its delimiter',
    async (param, expected) => {
      const res = await callGeneratedClient(
        verifier,
        'search',
        { [param]: ['a', 'b'] },
        { json: 'ok' },
      );
      expect(res.ok).toBe(true);
      expect(requestQuery(res)).toBe(expected);
    },
  );

  it('repeats the key for an exploded array query parameter', async () => {
    const res = await callGeneratedClient(
      verifier,
      'search',
      { repeated: ['a', 'b'] },
      { json: 'ok' },
    );
    expect(requestQuery(res)).toBe('repeated=a&repeated=b');
  });

  // Python's `str()` would render these as `2026-04-18 10:00:00` and `True`,
  // neither of which a server parses.
  it('serialises dates, date-times and booleans in their wire form', async () => {
    const res = await callGeneratedClient(
      verifier,
      'search',
      { on: '2026-04-18', at: '2026-04-18T10:00:00', flag: true },
      { json: 'ok' },
    );
    const query = requestQuery(res);
    expect(query).toContain('on=2026-04-18');
    expect(query).toContain('at=2026-04-18T10%3A00%3A00');
    expect(query).toContain('flag=true');
  });

  it('omits query parameters left unset', async () => {
    const res = await callGeneratedClient(
      verifier,
      'search',
      {},
      { json: 'ok' },
    );
    expect(requestQuery(res)).toBe('');
  });

  // One collection-format map shared by both would let whichever came last
  // decide how the other is serialised.
  it('keeps query and header collection formats apart for a shared name', async () => {
    const res = await callGeneratedClient(
      verifier,
      'collide',
      { x: ['a', 'b'], x_header: ['c', 'd'] },
      { json: 'ok' },
    );
    expect(res.ok).toBe(true);
    // The query parameter keeps its pipeDelimited style...
    expect(requestQuery(res)).toBe('x=a%7Cb');
    // ...while the header keeps its own exploded (repeated) form.
    expect(expectSingleRequest(res).headers.x).toBe('c, d');
  });

  // RFC 6570 simple expansion is comma-separated; Python's `str(list)` would
  // put `['a', 'b']` in the path.
  it('serialises an array path parameter comma-separated', async () => {
    const res = await callGeneratedClient(
      verifier,
      'get_items',
      { ids: ['a', 'b'] },
      { json: 'ok' },
    );
    expect(new URL(expectSingleRequest(res).url).pathname).toBe('/items/a,b');
  });

  it('serialises cookie values in their wire form', async () => {
    const res = await callGeneratedClient(
      verifier,
      'cookied',
      { flag: true, at: '2026-04-18T10:00:00' },
      { json: 'ok' },
    );
    const cookie = expectSingleRequest(res).headers.cookie ?? '';
    expect(cookie).toContain('flag=true');
    expect(cookie).toContain('at=2026-04-18T10:00:00');
  });
});
