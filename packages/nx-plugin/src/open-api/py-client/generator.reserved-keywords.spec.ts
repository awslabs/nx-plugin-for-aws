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
});
