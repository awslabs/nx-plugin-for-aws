/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { PositionEncoding, Workspace } from '@astral-sh/ruff-wasm-nodejs';
import type { Tree } from '@nx/devkit';
import { PET_STORE_SPEC } from '../ts-client/generator.petstore.spec';
import type { Spec } from '../utils/types';
import {
  createPythonClientVerifier,
  createTree,
  generateAndRead,
  outputPath,
} from './generator.utils.spec';

/**
 * The lint settings a generated Python project vends, so a client emitted into
 * one is checked against exactly what that project's `lint` target enforces.
 * Anything reported here is a violation in code the user didn't write.
 */
const workspace = new Workspace(
  {
    'line-length': 120,
    'target-version': 'py314',
    lint: { select: ['E', 'F', 'UP', 'B', 'SIM', 'I'] },
  },
  PositionEncoding.Utf16,
);

interface Diagnostic {
  readonly code: string | null;
  readonly message: string;
  readonly start_location: { readonly row: number };
}

/** Ruff's diagnostics for one generated module, as `file:line CODE message`. */
const lint = (name: string, content: string): string[] =>
  (workspace.check(content) as Diagnostic[]).map(
    (d) => `${name}:${d.start_location.row} ${d.code ?? '?'} ${d.message}`,
  );

describe('openApiPyClientGenerator - lint', () => {
  let tree: Tree;
  const verifier = createPythonClientVerifier();

  beforeEach(() => {
    tree = createTree();
  });

  const lintGenerated = (): string[] =>
    tree
      .children(outputPath)
      .filter((child) => child.endsWith('.py'))
      .flatMap((child) =>
        lint(child, tree.read(`${outputPath}/${child}`, 'utf-8') ?? ''),
      );

  it('emits a petstore client with no lint violations', async () => {
    await generateAndRead(verifier, tree, PET_STORE_SPEC);
    expect(lintGenerated()).toEqual([]);
  });

  // The petstore doesn't exercise every construct, so a spec built to hit the
  // ones with their own rendering paths is linted too.
  it('emits no lint violations for unions, streams, aliases and long text', async () => {
    const spec: Spec = {
      openapi: '3.1.0',
      info: { title: 'LintApi', version: '1.0.0' },
      paths: {
        '/stream': {
          get: {
            operationId: 'streamThings',
            description:
              'A description long enough that a single-line docstring would run past the line length the generated project lints with, so it has to be wrapped.',
            responses: {
              '200': {
                description: 'stream',
                content: {
                  'application/jsonl': {
                    schema: { $ref: '#/components/schemas/Thing' },
                    itemSchema: { $ref: '#/components/schemas/Thing' },
                  },
                },
              },
            },
          },
        },
        '/things/{id}': {
          put: {
            operationId: 'putThing',
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
              {
                name: 'tags',
                in: 'query',
                schema: { type: 'array', items: { type: 'string' } },
              },
            ],
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Pet' },
                },
              },
            },
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Things' },
                  },
                },
              },
              '404': { description: 'Missing' },
              default: { description: 'Boom' },
            },
          },
        },
      },
      components: {
        schemas: {
          Thing: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string' },
              note: { type: ['string', 'null'] },
              kind: { type: 'string', enum: ['a', 'b'] },
            },
          },
          Things: {
            type: 'array',
            items: { $ref: '#/components/schemas/Thing' },
          },
          Dog: {
            type: 'object',
            required: ['pet_type', 'bark'],
            properties: {
              pet_type: { type: 'string', enum: ['dog'] },
              bark: { type: 'boolean' },
            },
          },
          Cat: {
            type: 'object',
            required: ['pet_type', 'meows'],
            properties: {
              pet_type: { type: 'string', enum: ['cat'] },
              meows: { type: 'integer' },
            },
          },
          Pet: {
            oneOf: [
              { $ref: '#/components/schemas/Dog' },
              { $ref: '#/components/schemas/Cat' },
            ],
            discriminator: { propertyName: 'pet_type' },
          },
        },
      },
    };
    await generateAndRead(verifier, tree, spec);
    expect(lintGenerated()).toEqual([]);
  });

  // An operation with no error responses is the only user of `Never`, so the
  // import has to be conditional or it is a plain unused import.
  it('emits no unused imports for a spec with no error responses', async () => {
    await generateAndRead(verifier, tree, {
      openapi: '3.0.0',
      info: { title: 'LintApi', version: '1.0.0' },
      paths: {
        '/ok': {
          get: {
            operationId: 'ok',
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    });
    expect(lintGenerated()).toEqual([]);
  });
});
