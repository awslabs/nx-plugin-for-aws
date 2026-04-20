/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { Spec } from '../utils/types';
import { PythonVerifier } from '../../utils/test/py.spec';
import {
  createTree,
  generateAndRead,
  outputPath,
} from './generator.utils.spec';

const execFileP = promisify(execFile);

/**
 * A spec exercising every feature whose type-safety we care about.  The spec
 * is deliberately dense so a single pyright invocation can assert full
 * parity with the ts-client side.
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

/** Probe file mixing valid usage (must produce no errors) with deliberate errors. */
const probeUsage = `"""Type-safety probe against the generated client."""

from __future__ import annotations

import datetime

from demo_client import types_gen as t
from demo_client.client_gen import (
    AddPetApiError,
    ApiError,
    TypeSafetyApi,
    TypeSafetyApiConfig,
)


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


def expected_errors(api: TypeSafetyApi) -> None:
    # E1
    api.pet.add_pet()
    # E2
    api.pet.add_pet(name=42)
    # E3
    api.pet.add_pet(name="r", nom="r")
    # E4
    api.pet.list_pets(status=["unknown"], x_api_key="k")
    # E5
    _bad: dict[str, int] = api.pet.add_pet(name="rex")
    # E6
    api.unknown_method()
    # E7
    api.pet.delete_pet(pet_id="forty-two")
    # E8
    api.create_event(day="2026-04-18", moment=datetime.datetime.now())
    # E9
    api.union(value=[1, 2])
    # E10
    try:
        api.pet.add_pet(name="r")
    except AddPetApiError as e:
        _x: str = e.error.detail
    # E11
    api.pet.batch_create([{"name": "a"}])
    # E12
    api.pet.delete_pet()
    # E13
    api.pet.list_pets(status=["available"], x_api_key="k", limit="ten")
    # E14
    _chunks: list[str] = list(api.stream())
    # E15
    TypeSafetyApiConfig()
`;

const expectedDiagnostics = [
  {
    label: 'E1 missing required kwarg',
    pattern: /Argument missing for parameter "name"/i,
  },
  {
    label: 'E2 wrong kwarg type',
    pattern: /"Literal\[42\]" is not assignable to "str"/,
  },
  { label: 'E3 unknown kwarg', pattern: /No parameter named "nom"/ },
  {
    label: 'E4 array-literal enum unknown value',
    pattern: /"Literal\['unknown'\]"|"Literal\["unknown"\]"/,
  },
  {
    label: 'E5 return-type mismatch',
    pattern: /"Pet" is not assignable to "dict\[str, int\]"/,
  },
  {
    label: 'E6 unknown method',
    pattern: /Cannot access attribute "unknown_method"/,
  },
  {
    label: 'E7 wrong path-param type',
    pattern: /"Literal\['forty-two'\]".*not assignable.*"int"/s,
  },
  {
    label: 'E8 date field wrong type',
    pattern: /"Literal\['2026-04-18'\]"|"str".*not assignable.*"date"/s,
  },
  {
    label: 'E9 union rejects non-member type',
    pattern: /"list\[int\]" cannot be assigned to parameter "value"/,
  },
  {
    label: 'E10 unnarrowed error access',
    pattern: /Cannot access attribute "detail"/,
  },
  {
    label: 'E11 batch body wrong type',
    pattern: /"list\[dict\[str, str\]\]".*"list\[Pet\]"/s,
  },
  {
    label: 'E12 missing path param',
    pattern: /Argument missing for parameter "pet_id"/,
  },
  {
    label: 'E13 wrong query param type',
    pattern: /"Literal\['ten'\]".*not assignable.*"int"/s,
  },
  {
    label: 'E14 streaming return mismatch',
    pattern: /"list\[Chunk\]" is not assignable to "list\[str\]"/,
  },
  {
    label: 'E15 Config url required',
    pattern: /Argument missing for parameter "url"/,
  },
];

describe('openApiPyClientGenerator - type-safety parity matrix', () => {
  let verifier: PythonVerifier;

  beforeAll(() => {
    verifier = new PythonVerifier();
  });

  afterAll(async () => {
    await verifier.shutdown();
  });

  it('matches ts-client type safety under pyright across 15 diagnostic signals', async () => {
    const tree = createTree();
    const { types, client } = await generateAndRead(
      verifier,
      tree,
      parityMatrixSpec,
    );
    // Guard: without the enum-in-collection fix the list[Literal[...]] is
    // just list[str], which would make E4 silently pass.
    expect(client).toMatch(/Literal\["available"/);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'py-parity-'));
    try {
      const pkgDir = path.join(tmp, 'demo_client');
      fs.mkdirSync(pkgDir, { recursive: true });
      for (const f of [
        '__init__.py',
        'types_gen.py',
        'client_gen.py',
        'async_client_gen.py',
      ]) {
        fs.writeFileSync(
          path.join(pkgDir, f),
          tree.read(`${outputPath}/${f}`, 'utf-8') ?? '',
        );
      }
      fs.writeFileSync(path.join(tmp, 'usage.py'), probeUsage);
      fs.writeFileSync(
        path.join(tmp, 'pyrightconfig.json'),
        JSON.stringify({
          include: ['usage.py'],
          extraPaths: ['.'],
          venvPath: '/tmp/typecheck-probe',
          venv: '.venv',
          typeCheckingMode: 'standard',
        }),
      );

      // Run pyright.  It exits non-zero when there are diagnostics, so we
      // ignore the exit code and parse the JSON output.
      let stdout = '';
      try {
        const result = await execFileP(
          '/tmp/typecheck-probe/.venv/bin/pyright',
          ['--outputjson', 'usage.py'],
          { cwd: tmp, maxBuffer: 16 * 1024 * 1024 },
        );
        stdout = result.stdout;
      } catch (err: any) {
        stdout = err.stdout ?? '';
      }

      const report = JSON.parse(stdout);
      const diagnostics = (report.generalDiagnostics ?? []) as Array<{
        severity: string;
        message: string;
        range: { start: { line: number } };
      }>;
      const errorMessages = diagnostics
        .filter((d) => d.severity === 'error')
        .map((d) => d.message);

      for (const { label, pattern } of expectedDiagnostics) {
        const matched = errorMessages.some((m) => pattern.test(m));
        if (!matched) {
          throw new Error(
            `Missing type-safety check [${label}].\nAll errors:\n` +
              errorMessages
                .map((m) => `  - ${m.replace(/\n/g, ' ')}`)
                .join('\n'),
          );
        }
      }

      const validStart = probeUsage
        .split('\n')
        .findIndex((line) => line.startsWith('def valid_usage'));
      const validEnd = probeUsage
        .split('\n')
        .findIndex((line) => line.startsWith('def expected_errors'));
      const falsePositives = diagnostics.filter(
        (d) =>
          d.severity === 'error' &&
          d.range.start.line >= validStart &&
          d.range.start.line < validEnd,
      );
      if (falsePositives.length > 0) {
        throw new Error(
          `valid_usage block produced ${falsePositives.length} unexpected errors:\n` +
            falsePositives
              .map(
                (d) =>
                  `  line ${d.range.start.line + 1}: ${d.message.replace(/\n/g, ' ')}`,
              )
              .join('\n'),
        );
      }

      expect(types).toBeDefined();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 120_000);
});
