/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import type { Spec } from '../utils/types.js';
import { openApiPyClientGenerator } from './generator.js';
import {
  callGeneratedClient,
  createPythonClientVerifier,
  createTree,
  expectSingleRequest,
  generateAndRead,
  outputPath,
  requestQuery,
} from './generator.utils.spec.js';

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
    expect(types).toContain('note: str | None');
    expect(types).not.toMatch(/note: str \| None = /);

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

  // snake_case strips everything non-alphanumeric, so a tag or operationId in
  // another script yields the empty string and a leading digit isn't a valid
  // identifier. Either would emit a module that doesn't parse.
  it('emits valid identifiers for names that do not snake_case', async () => {
    const { client, asyncClient } = await generateAndRead(verifier, tree, {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/cjk': {
          get: {
            operationId: '取得',
            tags: ['ペット'],
            responses: { '204': { description: 'No content' } },
          },
        },
        '/num': {
          get: {
            operationId: 'numTagOp',
            tags: ['123-numeric-start'],
            responses: { '204': { description: 'No content' } },
          },
        },
      },
    });
    // Generation would otherwise emit `self.:` / `self.123_numeric_start`.
    for (const module of [client, asyncClient]) {
      expect(module).not.toMatch(/self\.\s*:/);
      expect(module).not.toMatch(/self\.\d/);
      expect(module).not.toMatch(/def\s*\(/);
    }
  });

  it('calls an operation whose name does not snake_case', async () => {
    await generateAndRead(verifier, tree, {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/cjk': {
          get: {
            operationId: '取得',
            responses: {
              '200': {
                description: 'OK',
                content: { 'application/json': { schema: { type: 'string' } } },
              },
            },
          },
        },
      },
    });
    // The operation id has no alphanumerics to snake_case, so it falls back to a
    // generated identifier rather than emitting an empty one.
    const res = await callGeneratedClient(verifier, 'u_', {}, { json: 'ok' });
    expect(res.ok).toBe(true);
    expect(res.value).toBe('ok');
  });

  // Three parameters snake_casing towards one name: the query `fooBar` takes
  // `foo_bar`, so the header `fooBarHeader` is qualified to `foo_bar_header` —
  // which is what the header `foo_bar` would also be qualified to. Without a
  // loop that emits `def m(foo_bar_header, ..., foo_bar_header)`, a hard
  // `SyntaxError: duplicate argument`.
  it('keeps deduplicated argument names distinct when the qualified form collides', async () => {
    await generateAndRead(verifier, tree, {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/x': {
          get: {
            operationId: 'getX',
            parameters: [
              { name: 'fooBar', in: 'query', schema: { type: 'string' } },
              {
                name: 'fooBarHeader',
                in: 'header',
                schema: { type: 'string' },
              },
              { name: 'foo_bar', in: 'header', schema: { type: 'string' } },
            ],
            responses: { '204': { description: 'No content' } },
          },
        },
      },
    });
    const res = await callGeneratedClient(
      verifier,
      'get_x',
      { foo_bar: 'q', foo_bar_header: 'h1', foo_bar_header_: 'h2' },
      { status: 204 },
    );
    expect(res.ok).toBe(true);
    const call = expectSingleRequest(res);
    // Each parameter must reach its own wire name, not overwrite a sibling.
    expect(new URL(call.url).searchParams.get('fooBar')).toBe('q');
    expect(call.headers['foobarheader']).toBe('h1');
    expect(call.headers['foo_bar']).toBe('h2');
  });

  // An `operationId` with no alphanumerics, or one starting with a digit, also
  // names the generated error classes — where an invalid identifier does not
  // parse. Independent FastAPI testing found `42Error = Never` and
  // `class 42ApiError`.
  it('emits valid class names for operation ids that are not identifiers', async () => {
    const { types, errors } = await generateAndRead(verifier, tree, {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/a': {
          get: {
            operationId: '42',
            tags: ['t'],
            responses: {
              '200': { description: 'OK' },
              '404': { description: 'No' },
            },
          },
        },
        '/b': {
          get: {
            operationId: '1stOperation',
            tags: ['t'],
            responses: { '200': { description: 'OK' } },
          },
        },
        // Nothing alphanumeric at all, so the escaped name is empty. An empty
        // prefix named this operation's error class `ApiError` — redefining the
        // base class it derives from, so the classes emitted after it inherited
        // from the redefinition and `except ApiError` caught the wrong type.
        '/c': {
          get: {
            operationId: '___',
            tags: ['t'],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    });
    for (const module of [types, errors]) {
      // No class or alias may begin with a digit.
      expect(module).not.toMatch(/^class \d/m);
      expect(module).not.toMatch(/^\d\w* = /m);
      expect(module).not.toMatch(/class \d\w*ApiError/);
    }
    // Every emitted class name is distinct, and none redefines the base.
    const classNames = [...errors.matchAll(/^class (\w+)/gm)].map((m) => m[1]);
    expect(classNames).toContain('ApiError');
    expect(new Set(classNames).size).toBe(classNames.length);
    // The base is the only class deriving from `Exception`; the rest extend it.
    expect(errors).toMatch(/^class ApiError\(Exception\)/m);
    expect(errors).not.toMatch(/^class ApiError\(ApiError\)/m);
  });

  // An object schema with no properties and no `additionalProperties` parsed as
  // a dictionary whose value type was the model itself, emitting the
  // self-referential `Empty = dict[str, Empty]` — a `NameError` on import, which
  // a parse-only check does not catch.
  it('emits an empty object schema as a class, not a self-referential alias', async () => {
    const { types } = await generateAndRead(verifier, tree, {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/e': {
          post: {
            operationId: 'postEmpty',
            tags: ['e'],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Empty' },
                },
              },
            },
            responses: { '204': { description: 'No content' } },
          },
        },
      },
      components: {
        schemas: { Empty: { type: 'object', properties: {} } },
      },
    });
    expect(types).toContain('class Empty(BaseModel):');
    expect(types).not.toContain('Empty = dict[str, Empty]');
  });

  // A keyword argument shares a scope with the locals the method assigns and the
  // builtins its annotations subscript. Independent FastAPI testing found a body
  // field named `header_params` sent as `{}` and a param named `list` breaking
  // `TypeAdapter(list[...])` with a TypeError.
  it('escapes arguments that would shadow a method local or a builtin', async () => {
    const { client } = await generateAndRead(verifier, tree, {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/s': {
          post: {
            operationId: 'shadow',
            parameters: [
              { name: 'list', in: 'query', schema: { type: 'string' } },
              { name: 'query_params', in: 'query', schema: { type: 'string' } },
            ],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['header_params'],
                    properties: { header_params: { type: 'string' } },
                  },
                },
              },
            },
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
    });
    for (const escaped of [
      'var_list',
      'var_query_params',
      'var_header_params',
    ]) {
      expect(client).toContain(escaped);
    }
    // The locals must still be the client's own, assigned after the kwargs.
    expect(client).toMatch(/^ {8}query_params: dict\[str, Any\] = /m);
    expect(client).toContain('TypeAdapter(list[str])');
  });

  // The client emits more private helpers than were reserved, so an operation
  // named after one replaced it — breaking every *other* operation that calls it.
  it('keeps an operation from replacing a private client helper', async () => {
    const { client } = await generateAndRead(verifier, tree, {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/x': {
          get: {
            operationId: 'scalar',
            tags: ['t'],
            parameters: [
              { name: 'q', in: 'query', schema: { type: 'string' } },
            ],
            responses: { '204': { description: 'No content' } },
          },
        },
      },
    });
    // The helper survives, and the operation is pushed out of its name.
    expect(client).toMatch(/^ {4}def _scalar\(self, value: Any\) -> str:$/m);
    expect(client).toContain('def _scalar_op(');
  });

  // Two tags differing only in punctuation become one namespace. That is
  // harmless while their operation ids differ, but where the ids also collapse an
  // operation was dropped from the client with no error at all — the duplicate-id
  // check keyed on the raw tag and so never saw them as sharing a namespace.
  it('rejects colliding operation ids across tags that share a namespace', async () => {
    tree.write(
      'openapi.json',
      JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'TestApi', version: '1.0.0' },
        paths: {
          '/a': {
            get: {
              operationId: 'get',
              tags: ['my-tag'],
              responses: { '204': { description: 'No' } },
            },
          },
          '/b': {
            get: {
              operationId: 'get',
              tags: ['my.tag'],
              responses: { '204': { description: 'No' } },
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
    ).rejects.toThrow(/cannot have the same operationId/);
  });

  it('merges tags that share a namespace when their operation ids differ', async () => {
    const { client } = await generateAndRead(verifier, tree, {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/a': {
          get: {
            operationId: 'getA',
            tags: ['my-tag'],
            responses: { '204': { description: 'No' } },
          },
        },
        '/b': {
          get: {
            operationId: 'getB',
            tags: ['my.tag'],
            responses: { '204': { description: 'No' } },
          },
        },
      },
    });
    // Both operations must remain reachable — neither is dropped.
    expect(client).toContain('def get_a(');
    expect(client).toContain('def get_b(');
    expect(client).toContain('self.my_tag');
  });

  /**
   * The names derived per operation share `types.py` with the classes declared for
   * schemas, so a spec may already have taken one. Emitting it twice is invisible
   * to both `ast.parse` and the import — Python simply keeps the last definition,
   * which silently retypes every reference to the schema it replaced.
   */
  describe('a schema named like a generated class', () => {
    const collidingSpec = (schemaName: string): Spec => ({
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/a': {
          get: {
            operationId: 'getThing',
            tags: ['t'],
            parameters: [
              { name: 'q', in: 'query', schema: { type: 'string' } },
            ],
            responses: {
              '200': {
                description: 'OK',
                content: { 'application/json': { schema: { type: 'string' } } },
              },
              '404': {
                description: 'Not found',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { msg: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
        // Referenced so the schema is reachable and must keep its own shape.
        '/b': {
          get: {
            operationId: 'useIt',
            tags: ['t'],
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: `#/components/schemas/${schemaName}` },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          [schemaName]: {
            type: 'object',
            required: ['mine'],
            properties: { mine: { type: 'string' } },
          },
        },
      },
    });

    it.each([
      // The per-status error wrapper, the union alias over them, and the model
      // built for a parameter position.
      'GetThing404Error',
      'GetThingError',
      'GetThingRequestQueryParameters',
    ])('keeps the schema %s and renames the generated class', async (name) => {
      const { types } = await generateAndRead(
        verifier,
        tree,
        collidingSpec(name),
      );
      // Only module-level declarations: a `class X(...)` or an `X = ...` alias.
      const declared = [
        ...types.matchAll(/^class (\w+)\(/gm),
        ...types.matchAll(/^(\w+) = /gm),
      ].map((match) => match[1]);
      expect(new Set(declared).size).toBe(declared.length);
      // The schema keeps the name it was given, with its own property.
      expect(types).toMatch(
        new RegExp(`^class ${name}\\(BaseModel\\):[\\s\\S]*?mine: str`, 'm'),
      );
    });
  });

  // A hoisted inline schema disambiguates against the declared names, but the
  // suffixed result was not itself checked — so a spec declaring `OuterInner1`
  // had it replaced by the schema hoisted out of `Outer.inner`.
  it('does not take a declared name when disambiguating a hoisted schema', async () => {
    const { types } = await generateAndRead(verifier, tree, {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/a': {
          get: {
            operationId: 'getA',
            tags: ['t'],
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Outer' },
                  },
                },
              },
            },
          },
        },
        '/b': {
          get: {
            operationId: 'getB',
            tags: ['t'],
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/OuterInner1' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Outer: {
            type: 'object',
            properties: {
              inner: {
                type: 'object',
                properties: { hoisted: { type: 'string' } },
              },
            },
          },
          OuterInner: {
            type: 'object',
            required: ['declared0'],
            properties: { declared0: { type: 'string' } },
          },
          OuterInner1: {
            type: 'object',
            required: ['declared1'],
            properties: { declared1: { type: 'boolean' } },
          },
        },
      },
    });
    // Each declared schema keeps its own property.
    expect(types).toMatch(
      /^class OuterInner\(BaseModel\):[\s\S]*?declared0: str/m,
    );
    expect(types).toMatch(
      /^class OuterInner1\(BaseModel\):[\s\S]*?declared1: bool/m,
    );
    // The hoisted schema took the next free name, and is what `inner` refers to.
    expect(types).toMatch(
      /^class OuterInner2\(BaseModel\):[\s\S]*?hoisted: str/m,
    );
    expect(types).toContain('inner: OuterInner2 | None');
  });

  /**
   * The spec title names the client class. It reaches the templates already
   * class-cased for TypeScript, where every result is a legal name — Python is
   * stricter, and these modules also export an `ApiError` of their own that the
   * title must not shadow.
   */
  it.each([
    // No alphanumerics at all, so the shared name is empty: `class :`.
    ['___', 'U'],
    ['日本語', 'U'],
    // A keyword, and the base exception these modules export.
    ['None', '_None'],
    ['ApiError', '_ApiError'],
  ])('names the client class for a title of %s', async (title, expected) => {
    const { client, init } = await generateAndRead(verifier, tree, {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/a': {
          get: {
            operationId: 'getA',
            tags: ['t'],
            responses: {
              '200': {
                description: 'OK',
                content: { 'application/json': { schema: { type: 'string' } } },
              },
            },
          },
        },
      },
    });
    expect(client).toContain(`class ${expected}:`);
    expect(client).toContain(`class ${expected}Config:`);
    // The re-export names the same class, so the package root stays usable.
    expect(init).toContain(`import ${expected} as ${expected}`);
  });

  // A digit-leading operationId names the request TypedDict too, and TypeScript
  // accepts `42Request` where Python does not.
  it('emits a valid request type name for a digit-leading operation id', async () => {
    const { types } = await generateAndRead(verifier, tree, {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/a': {
          get: {
            operationId: '42',
            tags: ['t'],
            parameters: [
              {
                name: 'q',
                in: 'query',
                required: true,
                schema: { type: 'string' },
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
    });
    expect(types).not.toMatch(/^class \d/m);
    // Escaped the same way as the sibling model built for the query position, so
    // the two names stay consistent.
    expect(types).toMatch(/^class _42Request\(TypedDict\)/m);
    expect(types).toMatch(/^class _42RequestQueryParameters/m);
  });

  /**
   * A client annotation naming a type `types.py` never declares raises
   * `AttributeError` when the operation is called — after the module has parsed
   * and imported cleanly, so neither check sees it.
   */
  const danglingTypeReferences = (
    types: string,
    ...clients: string[]
  ): string[] => {
    const declared = new Set([
      ...[...types.matchAll(/^class (\w+)[( :]/gm)].map((m) => m[1]),
      ...[...types.matchAll(/^(\w+) = /gm)].map((m) => m[1]),
    ]);
    const used = new Set(
      clients.flatMap((client) =>
        [...client.matchAll(/types\.(\w+)/g)].map((m) => m[1]),
      ),
    );
    return [...used].filter((name) => !declared.has(name)).sort();
  };

  // A named scalar reached through `items` is inlined, and the array wrapping it
  // was substituted without following through — leaving `items` pointing at a
  // schema the same pass deleted, so the client was annotated
  // `list[types.IndexName]` with nothing of that name declared.
  it('declares every type its client refers to for an array of a named scalar', async () => {
    const { types, client, asyncClient } = await generateAndRead(
      verifier,
      tree,
      {
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
                    'application/json': {
                      schema: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/IndexName' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        components: {
          schemas: { IndexName: { type: 'string', maxLength: 45 } },
        },
      },
    );
    expect(danglingTypeReferences(types, client, asyncClient)).toEqual([]);
    // The chain collapses to the scalar rather than keeping a named alias.
    expect(client).toContain('-> list[str]');
  });

  // A media type's parameters do not identify it (RFC 9110 §8.3), and matching
  // `application/json` exactly meant `application/json; charset=utf-8` hoisted
  // nothing — so the response resolved to a name that was never declared.
  it('hoists a JSON schema declared with a charset parameter', async () => {
    const { types, client, asyncClient } = await generateAndRead(
      verifier,
      tree,
      {
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
                    'application/json; charset=utf-8': {
                      schema: {
                        oneOf: [
                          { $ref: '#/components/schemas/Users' },
                          { $ref: '#/components/schemas/UsersList' },
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
        },
        components: {
          schemas: {
            Users: {
              type: 'object',
              required: ['a'],
              properties: { a: { type: 'string' } },
            },
            UsersList: {
              type: 'object',
              required: ['b'],
              properties: { b: { type: 'string' } },
            },
          },
        },
      },
    );
    expect(danglingTypeReferences(types, client, asyncClient)).toEqual([]);
    expect(types).toContain('GetX200Response = ');
  });
});
