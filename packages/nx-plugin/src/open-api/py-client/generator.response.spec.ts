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

describe('openApiPyClientGenerator - responses', () => {
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
    expect(types).toMatchSnapshot('types_gen.py');
    expect(client).toMatchSnapshot('client_gen.py');

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
    expect(types).toMatchSnapshot('types_gen.py');
    expect(client).toMatchSnapshot('client_gen.py');
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
});
