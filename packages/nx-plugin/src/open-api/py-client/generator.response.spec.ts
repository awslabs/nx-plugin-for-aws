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
  generateAndRead,
} from './generator.utils.spec';

describe('openApiPyClientGenerator - responses', () => {
  let tree: Tree;
  const verifier = createPythonClientVerifier();

  beforeEach(() => {
    tree = createTree();
  });

  it('should handle multiple response status codes', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/check': {
          get: {
            operationId: 'check',
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Ok' },
                  },
                },
              },
              '400': {
                description: 'bad request',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/BadReq' },
                  },
                },
              },
              '500': {
                description: 'server error',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Err' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Ok: {
            type: 'object',
            required: ['message'],
            properties: { message: { type: 'string' } },
          },
          BadReq: {
            type: 'object',
            required: ['reason'],
            properties: { reason: { type: 'string' } },
          },
          Err: {
            type: 'object',
            required: ['code'],
            properties: { code: { type: 'integer' } },
          },
        },
      },
    };
    const { types, client } = await generateAndRead(verifier, tree, spec);
    expect(types).toMatchSnapshot('types.py');
    expect(client).toMatchSnapshot('client.py');

    // 200 returns the success payload.
    const ok = await callGeneratedClient(
      verifier,
      'check',
      {},
      { status: 200, json: { message: 'ok' } },
    );
    expect(ok.ok).toBe(true);
    expect(ok.value).toEqual({ message: 'ok' });

    // 400 raises the per-op exception with the discriminated-union member.
    const bad = await callGeneratedClient(
      verifier,
      'check',
      {},
      { status: 400, json: { reason: 'bad input' } },
    );
    expect(bad.ok).toBe(false);
    expect(bad.exception?.type).toBe('CheckApiError');
    expect(bad.exception?.error_type).toBe('Check400Error');
    expect(bad.exception?.status).toBe(400);

    // 500 also raises, with a different union member.
    const fail = await callGeneratedClient(
      verifier,
      'check',
      {},
      { status: 500, json: { code: 42 } },
    );
    expect(fail.ok).toBe(false);
    expect(fail.exception?.error_type).toBe('Check500Error');
  });

  it('should handle default responses', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/maybe': {
          get: {
            operationId: 'maybe',
            responses: {
              '200': {
                description: 'OK',
                content: { 'application/json': { schema: { type: 'string' } } },
              },
              default: {
                description: 'err',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Err' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Err: {
            type: 'object',
            required: ['detail'],
            properties: { detail: { type: 'string' } },
          },
        },
      },
    };
    await generateAndRead(verifier, tree, spec);

    const res = await callGeneratedClient(
      verifier,
      'maybe',
      {},
      { status: 418, json: { detail: 'teapot' } },
    );
    expect(res.ok).toBe(false);
    expect(res.exception?.error_type).toBe('MaybeDefaultError');
    expect(res.exception?.status).toBe(418);
  });

  it('should handle only default response', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/only-default': {
          get: {
            operationId: 'onlyDefault',
            responses: {
              default: {
                description: 'anything',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Body' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Body: {
            type: 'object',
            required: ['message'],
            properties: { message: { type: 'string' } },
          },
        },
      },
    };
    const { types, client } = await generateAndRead(verifier, tree, spec);
    expect(types).toMatchSnapshot('types.py');
    expect(client).toMatchSnapshot('client.py');
  });

  it('should handle a 204 void response', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/delete/{id}': {
          delete: {
            operationId: 'remove',
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            responses: { '204': { description: 'No content' } },
          },
        },
      },
    };
    await generateAndRead(verifier, tree, spec);

    const res = await callGeneratedClient(
      verifier,
      'remove',
      { id: 'a' },
      { status: 204 },
    );
    expect(res.ok).toBe(true);
    expect(res.value).toBeNull();
  });

  // A `2XX` range alongside a concrete code still describes a success, so a 201
  // must return the range's body rather than raise.
  describe('success-eligible responses', () => {
    const rangeSpec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/x': {
          get: {
            operationId: 'get_x',
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['a'],
                      properties: { a: { type: 'string' } },
                    },
                  },
                },
              },
              '2XX': {
                description: 'Other success',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['b'],
                      properties: { b: { type: 'string' } },
                    },
                  },
                },
              },
              '500': { description: 'Boom' },
            },
          },
        },
      },
    };

    it('returns the concrete response for its own code', async () => {
      await generateAndRead(verifier, tree, rangeSpec);
      const res = await callGeneratedClient(
        verifier,
        'get_x',
        {},
        {
          status: 200,
          json: { a: 'hello' },
        },
      );
      expect(res.ok).toBe(true);
      expect(res.value).toEqual({ a: 'hello' });
    });

    it('returns the 2XX response for a code the range covers', async () => {
      await generateAndRead(verifier, tree, rangeSpec);
      const res = await callGeneratedClient(
        verifier,
        'get_x',
        {},
        {
          status: 201,
          json: { b: 'created' },
        },
      );
      expect(res.ok).toBe(true);
      expect(res.value).toEqual({ b: 'created' });
    });

    it('still raises for a declared error code', async () => {
      await generateAndRead(verifier, tree, rangeSpec);
      const res = await callGeneratedClient(
        verifier,
        'get_x',
        {},
        {
          status: 500,
        },
      );
      expect(res.ok).toBe(false);
      expect(res.exception?.status).toBe(500);
    });

    // A declared 204 alongside a 200 is a success with an empty body, not an
    // error.
    it('returns None for a second concrete success code', async () => {
      await generateAndRead(verifier, tree, {
        openapi: '3.0.0',
        info: { title: 'TestApi', version: '1.0.0' },
        paths: {
          '/y': {
            get: {
              operationId: 'get_y',
              responses: {
                '200': {
                  description: 'OK',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        required: ['a'],
                        properties: { a: { type: 'string' } },
                      },
                    },
                  },
                },
                '204': { description: 'No content' },
              },
            },
          },
        },
      });
      const res = await callGeneratedClient(
        verifier,
        'get_y',
        {},
        {
          status: 204,
        },
      );
      expect(res.ok).toBe(true);
      expect(res.value).toBeNull();
    });
  });

  // A `default`-only operation must not treat every status as a success: a 500
  // has to raise rather than be parsed as the declared body.
  describe('default-only responses', () => {
    const defaultOnlySpec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/z': {
          get: {
            operationId: 'get_z',
            responses: {
              default: {
                description: 'Whatever',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['c'],
                      properties: { c: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    it('returns the body for a 2xx status', async () => {
      await generateAndRead(verifier, tree, defaultOnlySpec);
      const res = await callGeneratedClient(
        verifier,
        'get_z',
        {},
        {
          status: 200,
          json: { c: 'ok' },
        },
      );
      expect(res.ok).toBe(true);
      expect(res.value).toEqual({ c: 'ok' });
    });

    it('raises for a non-2xx status', async () => {
      await generateAndRead(verifier, tree, defaultOnlySpec);
      const res = await callGeneratedClient(
        verifier,
        'get_z',
        {},
        {
          status: 500,
          json: { c: 'boom' },
        },
      );
      expect(res.ok).toBe(false);
      expect(res.exception?.status).toBe(500);
    });
  });

  // `if True:` is never a status check: a generated branch either carries a real
  // condition or is the sole unconditional error fallback.
  it('never guards a response branch with `if True:`', async () => {
    const { client, asyncClient } = await generateAndRead(verifier, tree, {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/a': {
          get: {
            operationId: 'getA',
            responses: {
              '200': { description: 'OK' },
              default: { description: 'Err' },
            },
          },
        },
      },
    });
    expect(client).not.toContain('if True:');
    expect(asyncClient).not.toContain('if True:');
  });
});
