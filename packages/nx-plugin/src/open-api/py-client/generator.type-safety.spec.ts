/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { PythonVerifier } from '../../utils/test/py.spec';
import type { Spec } from '../utils/types';
import { createTree, generateAndRead } from './generator.utils.spec';

/**
 * A spec exercising every feature whose type-safety we care about.  The spec
 * is deliberately dense so one generated client covers every signal.
 */
const parityMatrixSpec: Spec = {
  openapi: '3.1.0',
  info: { title: 'TypeSafetyApi', version: '1.0.0' },
  paths: {
    '/pets': {
      post: {
        tags: ['pet'],
        operationId: 'addPet',
        requestBody: {
          required: true,
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
                schema: { $ref: '#/components/schemas/Pet' },
              },
            },
          },
          '404': {
            description: 'not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/NotFound' },
              },
            },
          },
          '5XX': {
            description: 'server error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ServerError' },
              },
            },
          },
        },
      },
      get: {
        tags: ['pet'],
        operationId: 'listPets',
        parameters: [
          {
            name: 'status',
            in: 'query',
            required: true,
            explode: true,
            schema: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['available', 'pending', 'sold'],
              },
            },
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer' },
          },
          {
            name: 'x-api-key',
            in: 'header',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'session',
            in: 'cookie',
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Pet' },
                },
              },
            },
          },
        },
      },
    },
    '/pets/{petId}': {
      delete: {
        tags: ['pet'],
        operationId: 'deletePet',
        parameters: [
          {
            name: 'petId',
            in: 'path',
            required: true,
            schema: { type: 'integer' },
          },
        ],
        responses: { '204': { description: 'No content' } },
      },
    },
    '/pets/batch': {
      post: {
        tags: ['pet'],
        operationId: 'batchCreate',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: { $ref: '#/components/schemas/Pet' },
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
                  type: 'array',
                  items: { $ref: '#/components/schemas/Pet' },
                },
              },
            },
          },
        },
      },
    },
    '/health': {
      get: {
        operationId: 'health',
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/stream': {
      post: {
        operationId: 'stream',
        responses: {
          '200': {
            description: 'stream',
            content: {
              'application/jsonl': {
                schema: { $ref: '#/components/schemas/Chunk' },
                itemSchema: { $ref: '#/components/schemas/Chunk' },
              },
            },
          },
        },
      },
    },
    '/events': {
      post: {
        operationId: 'createEvent',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Event' },
            },
          },
        },
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Event' },
              },
            },
          },
        },
      },
    },
    '/inventory': {
      get: {
        operationId: 'getInventory',
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: { type: 'integer' },
                },
              },
            },
          },
        },
      },
    },
    '/union': {
      post: {
        operationId: 'union',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Wrap' },
            },
          },
        },
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Wrap' },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: 'object',
        required: ['name'],
        properties: {
          id: { type: 'integer', readOnly: true, description: 'Opaque id' },
          name: { type: 'string' },
          status: { type: 'string', enum: ['available', 'pending', 'sold'] },
          tags: { type: 'array', items: { type: 'string' } },
          owner: { $ref: '#/components/schemas/Owner' },
        },
      },
      Owner: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' } },
      },
      NotFound: {
        type: 'object',
        required: ['detail'],
        properties: { detail: { type: 'string' } },
      },
      ServerError: {
        type: 'object',
        required: ['code'],
        properties: { code: { type: 'integer' } },
      },
      Chunk: {
        type: 'object',
        required: ['index', 'message'],
        properties: {
          index: { type: 'integer' },
          message: { type: 'string' },
        },
      },
      Event: {
        type: 'object',
        required: ['day', 'moment'],
        properties: {
          day: { type: 'string', format: 'date' },
          moment: { type: 'string', format: 'date-time' },
        },
      },
      Wrap: {
        type: 'object',
        required: ['value'],
        properties: {
          value: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
        },
      },
    },
  },
};

/**
 * Usage that must type check cleanly. A false positive here would mean the
 * generated types reject a caller doing the right thing.
 */
const validUsage = `"""Valid usage of the generated client."""

from __future__ import annotations

import datetime

from . import types_gen as t
from .client_gen import TypeSafetyApi, TypeSafetyApiConfig
from .errors import AddPetApiError, ApiError


def valid_usage(api: TypeSafetyApi) -> None:
    _c: TypeSafetyApiConfig = TypeSafetyApiConfig(url="https://example.com")

    p: t.Pet = api.pet.add_pet(name="rex")
    _id: int | None = p.id
    _name: str = p.name

    _pets: list[t.Pet] = api.pet.list_pets(
        status=["available", "pending"],
        x_api_key="k",
        limit=10,
    )

    api.pet.delete_pet(pet_id=42)

    _ok: str = api.health()

    _new: list[t.Pet] = api.pet.batch_create([t.Pet(name="a"), t.Pet(name="b")])

    ev: t.Event = api.create_event(
        day=datetime.date(2026, 4, 18),
        moment=datetime.datetime(2026, 4, 18, 12, 0),
    )
    _d: datetime.date | None = ev.day

    _inv: dict[str, int] = api.get_inventory()

    _u: t.Wrap = api.union(value="hi")
    _u2: t.Wrap = api.union(value=7)

    for chunk in api.stream():
        _i: int = chunk.index
        _m: str = chunk.message

    try:
        api.pet.add_pet(name="rex")
    except AddPetApiError as e:
        _s: int = e.status
        if isinstance(e.error, t.AddPet404Error):
            _detail: str = e.error.error.detail
        elif isinstance(e.error, t.AddPet5XXError):
            _code: int = e.error.error.code

    try:
        api.pet.add_pet(name="r")
    except ApiError:
        pass
`;

/**
 * Each misuse the generated types must reject, with the `ty` rule that catches
 * it. One case per entry, checked on its own line, so a signal that stops
 * firing fails rather than being masked by another entry's diagnostic.
 */
const rejectedUsage: Array<{ label: string; code: string; rule: string }> = [
  {
    label: 'missing required kwarg',
    code: 'api.pet.add_pet()',
    rule: 'missing-argument',
  },
  {
    label: 'wrong kwarg type',
    code: 'api.pet.add_pet(name=42)',
    rule: 'invalid-argument-type',
  },
  {
    label: 'unknown kwarg',
    code: 'api.pet.add_pet(name="r", nom="r")',
    rule: 'unknown-argument',
  },
  {
    label: 'value outside an enum',
    code: 'api.pet.list_pets(status=["unknown"], x_api_key="k")',
    rule: 'invalid-argument-type',
  },
  {
    label: 'return type mismatch',
    code: '_bad: dict[str, int] = api.pet.add_pet(name="rex")',
    rule: 'invalid-assignment',
  },
  {
    label: 'unknown method',
    code: 'api.unknown_method()',
    rule: 'unresolved-attribute',
  },
  {
    label: 'wrong path parameter type',
    code: 'api.pet.delete_pet(pet_id="forty-two")',
    rule: 'invalid-argument-type',
  },
  {
    label: 'string where a date is declared',
    code: 'api.create_event(day="2026-04-18", moment=datetime.datetime.now())',
    rule: 'invalid-argument-type',
  },
  {
    label: 'type outside a union',
    code: 'api.union(value=[1, 2])',
    rule: 'invalid-argument-type',
  },
  {
    label: 'wrong body element type',
    code: 'api.pet.batch_create([{"name": "a"}])',
    rule: 'invalid-argument-type',
  },
  {
    label: 'missing path parameter',
    code: 'api.pet.delete_pet()',
    rule: 'missing-argument',
  },
  {
    label: 'wrong query parameter type',
    code: 'api.pet.list_pets(status=["available"], x_api_key="k", limit="ten")',
    rule: 'invalid-argument-type',
  },
  {
    label: 'streaming element type mismatch',
    code: '_chunks: list[str] = list(api.stream())',
    rule: 'invalid-assignment',
  },
  {
    label: 'config without a url',
    code: 'TypeSafetyApiConfig()',
    rule: 'missing-argument',
  },
  {
    label: 'error accessed without narrowing',
    code: [
      'try:',
      '        api.pet.add_pet(name="r")',
      '    except AddPetApiError as e:',
      '        _x: str = e.error.detail',
    ].join('\n'),
    rule: 'unresolved-attribute',
  },
];

/** Wrap a snippet in a module that imports the client. */
const usageModule = (body: string) =>
  [
    '"""Rejected usage of the generated client."""',
    '',
    'from __future__ import annotations',
    '',
    'import datetime',
    '',
    'from . import types_gen as t  # noqa: F401',
    'from .client_gen import TypeSafetyApi, TypeSafetyApiConfig',
    'from .errors import AddPetApiError, ApiError  # noqa: F401',
    '',
    '',
    'def usage(api: TypeSafetyApi) -> None:',
    `    ${body}`,
    '',
  ].join('\n');

describe('openApiPyClientGenerator - type safety', () => {
  let verifier: PythonVerifier;

  beforeAll(async () => {
    verifier = new PythonVerifier();
    // Compiling also type checks the client itself; these tests then check what
    // it lets a caller do.
    await generateAndRead(verifier, createTree(), parityMatrixSpec);
  });

  afterAll(async () => {
    await verifier.shutdown();
  });

  it('accepts valid usage with no diagnostics', async () => {
    expect(await verifier.typeCheckUsage(validUsage)).toEqual([]);
  });

  it.each(rejectedUsage)('rejects $label', async ({ code, rule }) => {
    const diagnostics = await verifier.typeCheckUsage(usageModule(code));
    expect(diagnostics.join('\n')).toContain(`error[${rule}]`);
  });
});
