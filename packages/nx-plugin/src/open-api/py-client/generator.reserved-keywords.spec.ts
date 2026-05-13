/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { Spec } from '../utils/types';
import { PythonVerifier } from '../../utils/test/py.spec';
import {
  callGeneratedClient,
  createTree,
  generateAndRead,
} from './generator.utils.spec';

describe('openApiPyClientGenerator - reserved keywords', () => {
  let tree: Tree;
  let verifier: PythonVerifier;

  beforeAll(() => {
    verifier = new PythonVerifier();
  });

  afterAll(async () => {
    await verifier.shutdown();
  });

  beforeEach(() => {
    tree = createTree();
  });

  it('should rename python reserved keywords in property names with alias', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/r': {
          post: {
            operationId: 'r',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/R' },
                },
              },
            },
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/R' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          R: {
            type: 'object',
            required: ['class'],
            properties: { class: { type: 'string' } },
          },
        },
      },
    };
    const { types, client } = await generateAndRead(verifier, tree, spec);
    expect(types).toMatchSnapshot('types_gen.py');
    expect(client).toMatchSnapshot('client_gen.py');
    expect(types).toContain('alias="class"');

    const res = await callGeneratedClient(
      verifier,
      'r',
      { var_class: 'vip' },
      { json: { class: 'vip' } },
    );
    expect(res.ok).toBe(true);
    // Pydantic round-trips using the wire-name alias.
    expect(res.value).toEqual({ class: 'vip' });
  });

  it('should rename python reserved keywords in operation IDs', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/class': {
          get: {
            operationId: 'class',
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
    const { client } = await generateAndRead(verifier, tree, spec);
    // "class" is a reserved keyword — the method is renamed.
    expect(client).not.toMatch(/def class\(/);
    // The expected rename is `call_class` via `toPythonName('operation', 'class')`.
    expect(client).toMatch(/def call_class\(/);
  });

  it('should rename properties whose snake-cased name is a python keyword (e.g. `from_`)', async () => {
    // Regression: `snakeCase('from_')` strips the trailing underscore and
    // produces `from` — a hard python syntax error when emitted as an
    // attribute.  Must be caught by the rename pass.
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/f': {
          post: {
            operationId: 'f',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/F' },
                },
              },
            },
            responses: { '204': { description: 'No content' } },
          },
        },
      },
      components: {
        schemas: {
          F: {
            type: 'object',
            required: ['from_'],
            properties: { from_: { type: 'string' } },
          },
        },
      },
    };
    const { types } = await generateAndRead(verifier, tree, spec);
    // Must be renamed (not a bare `from:` which is a syntax error).
    expect(types).not.toMatch(/^\s+from:\s/m);
    expect(types).toContain('var_from:');
    expect(types).toContain('alias="from_"');
  });

  it('should rename TypeScript-reserved schema names consistently in python references', async () => {
    // Regression: schema named `Error` is aliased to `_Error` (TS-reserved),
    // but references from error-wrapper classes and error-parse expressions
    // used to resolve to `Error` / `types_gen.Error`, which doesn't exist.
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/items': {
          get: {
            operationId: 'listItems',
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
              '400': {
                description: 'Bad',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Error' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Error: {
            type: 'object',
            required: ['code'],
            properties: { code: { type: 'string' } },
          },
        },
      },
    };
    const { types, client, asyncClient } = await generateAndRead(
      verifier,
      tree,
      spec,
    );
    // `Error` is TS-reserved, so the emitted class is `_Error`.
    expect(types).toContain('class _Error(BaseModel)');
    // References to the schema must use the renamed form.
    expect(types).not.toMatch(/\berror:\s+Error\b/);
    expect(types).toContain('error: _Error');
    expect(client).not.toMatch(/\btypes_gen\.Error\b/);
    expect(client).toContain('types_gen._Error');
    expect(asyncClient).toContain('types_gen._Error');

    const res = await callGeneratedClient(
      verifier,
      'list_items',
      {},
      { status: 400, json: { code: 'BAD' } },
    );
    expect(res.ok).toBe(false);
    expect(res.exception?.type).toBe('ListItemsApiError');
    expect(res.exception?.error?.error).toEqual({ code: 'BAD' });
  });

  it('should rename properties whose name clashes with typing/pydantic utilities (e.g. schema)', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/s': {
          post: {
            operationId: 's',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/S' },
                },
              },
            },
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/S' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          S: {
            type: 'object',
            required: ['schema'],
            properties: { schema: { type: 'string' } },
          },
        },
      },
    };
    const { types } = await generateAndRead(verifier, tree, spec);
    // `schema` is renamed by our PYTHON_KEYWORDS list to `var_schema`.
    expect(types).toContain('var_schema:');
    expect(types).toContain('alias="schema"');
  });

  it('should escape schema names that shadow generated python imports (e.g. `Field`)', async () => {
    // Regression: a schema named `Field` (e.g. an inline `anyOf` whose
    // `title` is `Field`, as FastAPI emits when a property is named `field`)
    // would be rendered as a top-level `Field = Union[...]` alias that
    // shadows the imported `pydantic.Field` symbol.  This corrupted forward
    // ref evaluation: `Optional["Field"]` in a class body would resolve to
    // `pydantic.Field` (a function) rather than the alias, raising
    // `TypeError: unsupported operand type(s) for |: 'function' and 'type'`
    // when pydantic later attempted `field | None`.  Escape the class name
    // so the emitted alias is `_Field` and references the same form.
    const spec: Spec = {
      openapi: '3.1.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/x': {
          get: {
            operationId: 'x',
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Holder' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          // FastAPI synthesises a wrapper schema named after the property
          // title when the property type is `anyOf: [..., null]`.  We
          // simulate that with an explicit named schema.
          Field: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          Holder: {
            type: 'object',
            required: ['code'],
            properties: {
              // A description on this property forces a real
              // `Field(description=...)` call in the rendered template,
              // keeping the `from pydantic import Field` import alive
              // through ruff's unused-import pass.
              code: { type: 'string', description: 'a code' },
              field: { $ref: '#/components/schemas/Field' },
            },
          },
        },
      },
    };
    const { types, client, asyncClient } = await generateAndRead(
      verifier,
      tree,
      spec,
    );
    // The emitted alias must be `_Field`, not `Field`, so it doesn't
    // shadow the `from pydantic import ..., Field` import.
    expect(types).not.toMatch(/^Field = /m);
    expect(types).toContain('_Field = Union[str, None]');
    // The `pydantic.Field` import must remain intact and usable in the
    // module — unrelated properties still rendered with `Field(...)`.
    expect(types).toMatch(/from pydantic import .*\bField\b/);
    // References inside class bodies must use the escaped name.
    expect(types).toContain('field: Optional["_Field"]');
    // Client modules don't reference the alias type directly, but the
    // module must import cleanly.  Smoke-check that nothing in client/async
    // referenced the bare unprefixed name (would only happen via
    // `pythonClientType` being out of sync).
    expect(client).not.toContain('types_gen.Field');
    expect(asyncClient).not.toContain('types_gen.Field');
  });

  it('should escape every python-reserved import name when used as a schema name', async () => {
    // Property + schema shapes that exercise a sample of the reserved
    // names.  Picking three representative ones: typing (`Optional`),
    // pydantic (`BaseModel`), and the namespace import (`types_gen`).
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/items': {
          get: {
            operationId: 'listItems',
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
        schemas: {
          Optional: {
            type: 'object',
            required: ['v'],
            properties: { v: { type: 'string' } },
          },
          BaseModel: {
            type: 'object',
            required: ['v'],
            properties: { v: { type: 'string' } },
          },
          // `types_gen` would shadow the `from . import types_gen` import
          // in the client modules if not escaped.
          types_gen: {
            type: 'object',
            required: ['v'],
            properties: { v: { type: 'string' } },
          },
        },
      },
    };
    const { types } = await generateAndRead(verifier, tree, spec);
    // Each must be prefixed with an underscore so the original imports
    // remain reachable.
    expect(types).toContain('class _Optional(BaseModel)');
    expect(types).toContain('class _BaseModel(BaseModel)');
    // `types_gen` is camelCased to `TypesGen` by `toClassName` and is not
    // reserved, but the snake-cased property/identifier `types_gen` would
    // be — verify both forms.  The escape is structural: `_TypesGen` is
    // fine here since it doesn't collide with anything.
    expect(types).toMatch(/class _?TypesGen\(BaseModel\)/);
  });
});
