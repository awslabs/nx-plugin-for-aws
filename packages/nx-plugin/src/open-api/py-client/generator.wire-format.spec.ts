/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import type { Spec } from '../utils/types.js';
import {
  callGeneratedClient,
  createPythonClientVerifier,
  createTree,
  expectRequestTarget,
  expectSingleRequest,
  generateAndRead,
  requestQuery,
} from './generator.utils.spec.js';

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
    '/opaque': {
      get: {
        operationId: 'opaque',
        parameters: [
          { name: 'token', in: 'cookie', schema: { type: 'string' } },
          { name: 'shape', in: 'cookie', schema: { type: 'string' } },
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

  // Servers do not URL-decode cookies, so anything escaped here arrives escaped.
  // `=` is the padding of every base64 token — a JWT, a Fernet session, a CSRF
  // token — and escaping it corrupted all of them.
  it('leaves a cookie value that needs no escaping literal', async () => {
    const res = await callGeneratedClient(
      verifier,
      'opaque',
      { token: 'gAAAAABn1Q==', shape: '{a:1}|x^y`z/%41' },
      { json: 'ok' },
    );
    const cookie = expectSingleRequest(res).headers.cookie ?? '';
    expect(cookie).toContain('token=gAAAAABn1Q==');
    // Every other RFC 6265 cookie-octet survives too, `%` included — escaping it
    // double-encoded a value that already carried a percent sequence.
    expect(cookie).toContain('shape={a:1}|x^y`z/%41');
  });

  // A `;` or `,` would otherwise be read as a delimiter, so those still escape.
  it('escapes only the characters a cookie parser reads as structure', async () => {
    const res = await callGeneratedClient(
      verifier,
      'opaque',
      { token: 'a;b,c d', shape: 'q"r\\s' },
      { json: 'ok' },
    );
    const cookie = expectSingleRequest(res).headers.cookie ?? '';
    expect(cookie).toContain('token=a%3Bb%2Cc%20d');
    expect(cookie).toContain('shape=q%22r%5Cs');
  });

  // httpx's `cookies=` goes through `http.cookiejar`, which skips a request that
  // already carries a `Cookie` header — so a caller with their own cookie auth
  // silently lost every operation cookie, including required ones.
  it('sends operation cookies alongside a caller-supplied Cookie header', async () => {
    const res = await callGeneratedClient(
      verifier,
      'cookied',
      { flag: true },
      { json: 'ok' },
      [],
      { headers: { Cookie: 'sso=abc' } },
    );
    const cookie = expectSingleRequest(res).headers.cookie ?? '';
    expect(cookie).toContain('sso=abc');
    expect(cookie).toContain('flag=true');
  });

  // A container in a cookie, header or path segment must expand per RFC 6570.
  // Python's own `str` would emit a repr — `['a', 'b']`, quotes and spaces
  // included — which no server parses.
  describe('containers outside the query string', () => {
    const containerSpec: Spec = {
      openapi: '3.0.3',
      info: { title: 'WireApi', version: '1.0.0' },
      paths: {
        '/ctr/{obj}': {
          get: {
            operationId: 'containers',
            parameters: [
              {
                name: 'tags',
                in: 'cookie',
                schema: { type: 'array', items: { type: 'string' } },
              },
              {
                name: 'x-ctx',
                in: 'header',
                schema: {
                  type: 'object',
                  properties: { a: { type: 'string' }, b: { type: 'string' } },
                },
              },
              {
                name: 'obj',
                in: 'path',
                required: true,
                schema: {
                  type: 'object',
                  properties: {
                    x: { type: 'integer' },
                    y: { type: 'integer' },
                  },
                },
              },
            ],
            responses: { '204': { description: 'No content' } },
          },
        },
      },
    };

    it('expands a list cookie, object header and object path parameter', async () => {
      await generateAndRead(verifier, tree, containerSpec);
      const res = await callGeneratedClient(
        verifier,
        'containers',
        { tags: ['a', 'b'], x_ctx: { a: '1', b: '2' }, obj: { x: 1, y: 2 } },
        { status: 204 },
      );
      expect(res.ok).toBe(true);
      const call = expectSingleRequest(res);
      // No Python repr anywhere on the wire.
      expect(JSON.stringify(call)).not.toMatch(/\['|'\]|\{'/);
      expect(call.headers['cookie']).toBe('tags=a,b');
      expect(call.headers['x-ctx']).toBe('a,1,b,2');
      expect(new URL(call.url).pathname).toBe('/ctr/x,1,y,2');
    });

    it('percent-encodes a cookie value containing a delimiter', async () => {
      await generateAndRead(verifier, tree, containerSpec);
      const res = await callGeneratedClient(
        verifier,
        'containers',
        { tags: ['a;b', 'c,d'], obj: { x: 1 } },
        { status: 204 },
      );
      expect(res.ok).toBe(true);
      // A raw `;` or `,` would be read as a cookie delimiter by the server.
      expect(expectSingleRequest(res).headers['cookie']).toBe(
        'tags=a%3Bb,c%2Cd',
      );
    });
  });
});
