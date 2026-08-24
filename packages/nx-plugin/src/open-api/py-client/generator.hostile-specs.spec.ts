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
  expectSingleRequest,
  generateAndRead,
  requestQuery,
} from './generator.utils.spec';

/**
 * Specs whose text or shape is hostile to code generation. Each one previously
 * produced a package that did not import, or a request no server could parse —
 * failures a spec-shaped test wouldn't reach because the input looks ordinary
 * until it reaches the template.
 */
describe('openApiPyClientGenerator - hostile specs', () => {
  let tree: Tree;
  const verifier = createPythonClientVerifier();

  beforeEach(() => {
    tree = createTree();
  });

  // A description is arbitrary text. A backslash starts a Python escape, and a
  // trailing one escapes the closing quotes of the docstring it sits in.
  it('escapes backslashes and quotes in descriptions', async () => {
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/thing': {
          get: {
            operationId: 'getThing',
            description: 'Ends with a backslash \\',
            responses: {
              '200': {
                description: 'OK',
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
            description: 'A path like C:\\new\\names and a "quoted" word',
            required: ['name'],
            properties: {
              name: {
                type: 'string',
                description: 'Trailing backslash \\ and "quotes"',
              },
            },
          },
        },
      },
    };

    // Compiling asserts the package imports and type checks; a mis-escaped
    // description is a SyntaxError rather than a wrong value.
    const { types } = await generateAndRead(verifier, tree, spec);
    expect(types).toContain('C:\\\\new\\\\names');
    expect(types).toContain('Trailing backslash \\\\');

    const res = await callGeneratedClient(
      verifier,
      'get_thing',
      {},
      { json: { name: 'x' } },
    );
    expect(res.ok).toBe(true);
    expect(res.value).toMatchObject({ name: 'x' });
  });

  // OpenAPI treats wildcard status codes case-insensitively; a lower-case one
  // was previously emitted as a literal code, which is not valid Python.
  it('handles lower-case wildcard status codes', async () => {
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/thing': {
          get: {
            operationId: 'getThing',
            responses: {
              '200': {
                description: 'OK',
                content: { 'application/json': { schema: { type: 'string' } } },
              },
              '5xx': {
                description: 'Server error',
                content: { 'application/json': { schema: { type: 'string' } } },
              },
            },
          },
        },
      },
    };
    const { types } = await generateAndRead(verifier, tree, spec);
    // Normalised to the upper-case form every consumer matches on.
    expect(types).toContain('GetThing5XXError');

    const res = await callGeneratedClient(
      verifier,
      'get_thing',
      {},
      { status: 503, json: 'boom' },
    );
    expect(res.ok).toBe(false);
    expect(res.exception?.error_type).toBe('GetThing5XXError');
  });

  // `default` renders as an unconditional branch, so it has to be emitted after
  // every concrete check no matter how the spec enumerated its responses.
  it('matches concrete status codes ahead of default, whatever the spec order', async () => {
    const response = (description: string) => ({
      description,
      content: { 'application/json': { schema: { type: 'string' } } },
    });
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/thing': {
          get: {
            operationId: 'getThing',
            // Deliberately declared with `default` first.
            responses: {
              default: response('Fallback'),
              '5XX': response('Server error'),
              '404': response('Missing'),
              '200': response('OK'),
            },
          },
        },
      },
    };
    await generateAndRead(verifier, tree, spec);

    const ok = await callGeneratedClient(
      verifier,
      'get_thing',
      {},
      {
        status: 200,
        json: 'fine',
      },
    );
    expect(ok.ok).toBe(true);
    expect(ok.value).toBe('fine');

    for (const [status, expected] of [
      [404, 'GetThing404Error'],
      [503, 'GetThing5XXError'],
      [301, 'GetThingDefaultError'],
    ] as const) {
      const res = await callGeneratedClient(
        verifier,
        'get_thing',
        {},
        {
          status,
          json: 'nope',
        },
      );
      expect(res.ok).toBe(false);
      expect(res.exception?.error_type).toBe(expected);
    }
  });

  // OpenAPI's default query style is form/explode: an object expands to one
  // parameter per property rather than being stringified.
  it('expands an object query parameter into its properties', async () => {
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/search': {
          get: {
            operationId: 'search',
            parameters: [
              {
                name: 'filter',
                in: 'query',
                schema: { $ref: '#/components/schemas/Filter' },
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
      components: {
        schemas: {
          Filter: {
            type: 'object',
            properties: { a: { type: 'string' }, b: { type: 'integer' } },
          },
        },
      },
    };
    await generateAndRead(verifier, tree, spec);

    const res = await callGeneratedClient(
      verifier,
      'search',
      { filter: { a: 'x', b: 1 } },
      { json: 'ok' },
    );
    expect(res.ok).toBe(true);
    expect(requestQuery(res)).toBe('a=x&b=1');

    const omitted = await callGeneratedClient(
      verifier,
      'search',
      {},
      {
        json: 'ok',
      },
    );
    expect(requestQuery(omitted)).toBe('');
  });

  // `#` would start the URL fragment, dropping this value and every parameter
  // after it, so it is encoded even though the parameter allows reserved
  // characters.
  it('encodes # in an allowReserved query parameter', async () => {
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/search': {
          get: {
            operationId: 'search',
            parameters: [
              {
                name: 'q',
                in: 'query',
                allowReserved: true,
                schema: { type: 'string' },
              },
              { name: 'page', in: 'query', schema: { type: 'string' } },
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
    await generateAndRead(verifier, tree, spec);

    const fragment = await callGeneratedClient(
      verifier,
      'search',
      { q: 'a#frag', page: '2' },
      { json: 'ok' },
    );
    const url = expectSingleRequest(fragment).url;
    expect(url).toContain('q=a%23frag');
    // The parameter after it survives, which the fragment would have swallowed.
    expect(url).toContain('page=2');

    // Other reserved characters still reach the server literally.
    const reserved = await callGeneratedClient(
      verifier,
      'search',
      { q: 'a/b:c', page: '2' },
      { json: 'ok' },
    );
    expect(expectSingleRequest(reserved).url).toContain('q=a/b:c');
  });

  // A required nullable property must be supplied — as null if that is the
  // value — so defaulting it would let an incomplete body validate.
  it('requires a nullable property the spec marks required', async () => {
    const spec: Spec = {
      openapi: '3.0.3',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/thing': {
          post: {
            operationId: 'send',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Thing' },
                },
              },
            },
            responses: {
              '200': {
                description: 'OK',
                content: { 'application/json': { schema: { type: 'string' } } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Thing: {
            type: 'object',
            required: ['note'],
            properties: { note: { type: 'string', nullable: true } },
          },
        },
      },
    };
    const { types } = await generateAndRead(verifier, tree, spec);
    // Optional in type but with no default, so omitting it is an error.
    expect(types).toContain('note: Optional[str]');
    expect(types).not.toMatch(/note: Optional\[str\] = /);

    const res = await callGeneratedClient(
      verifier,
      'send',
      { note: null },
      { json: 'ok' },
    );
    expect(res.ok).toBe(true);
    expect(JSON.parse(expectSingleRequest(res).body ?? '{}')).toEqual({
      note: null,
    });
  });
});
