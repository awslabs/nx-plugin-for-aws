/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { Spec } from '../utils/types';
import { PythonVerifier } from '../../utils/test/py.spec';
import {
  callGeneratedClient,
  callGeneratedClientAsync,
  createTree,
  generateAndRead,
} from './generator.utils.spec';

describe('openApiPyClientGenerator - errors', () => {
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

  const errorSpec: Spec = {
    openapi: '3.1.0',
    info: { title: 'ErrApi', version: '0.0.1' },
    paths: {
      '/pet/{petId}': {
        get: {
          operationId: 'getPet',
          parameters: [
            {
              name: 'petId',
              in: 'path',
              required: true,
              schema: { type: 'integer' },
            },
          ],
          responses: {
            '200': {
              description: 'ok',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Pet' },
                },
              },
            },
            '404': {
              description: 'missing',
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
            default: {
              description: 'unexpected',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Generic' },
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
          properties: { name: { type: 'string' } },
        },
        NotFound: {
          type: 'object',
          required: ['detail'],
          properties: { detail: { type: 'string' } },
        },
        ServerError: {
          type: 'object',
          required: ['code', 'message'],
          properties: {
            code: { type: 'integer' },
            message: { type: 'string' },
          },
        },
        Generic: {
          type: 'object',
          required: ['message'],
          properties: { message: { type: 'string' } },
        },
      },
    },
  };

  it('emits per-op exception class + discriminated error union', async () => {
    const { types, client } = await generateAndRead(verifier, tree, errorSpec);
    expect(types).toMatchSnapshot('types_gen.py');
    expect(client).toMatchSnapshot('client_gen.py');
    expect(client).toContain('class GetPetApiError(ApiError)');
    expect(types).toContain('class GetPet404Error(BaseModel)');
    expect(types).toContain('class GetPet5XXError(BaseModel)');
    expect(types).toContain('class GetPetDefaultError(BaseModel)');
    expect(types).toMatch(/GetPetError = Union\[/);
  });

  it('raises GetPet404Error on a declared 404 response', async () => {
    await generateAndRead(verifier, tree, errorSpec);
    const res = await callGeneratedClient(
      verifier,
      'get_pet',
      { pet_id: 1 },
      { status: 404, json: { detail: 'no pet' } },
    );
    expect(res.ok).toBe(false);
    expect(res.exception?.type).toBe('GetPetApiError');
    expect(res.exception?.error_type).toBe('GetPet404Error');
    expect(res.exception?.status).toBe(404);
  });

  it('raises GetPet5XXError for range-matched 500', async () => {
    await generateAndRead(verifier, tree, errorSpec);
    const res = await callGeneratedClient(
      verifier,
      'get_pet',
      { pet_id: 1 },
      { status: 500, json: { code: 1, message: 'boom' } },
    );
    expect(res.ok).toBe(false);
    expect(res.exception?.error_type).toBe('GetPet5XXError');
    expect(res.exception?.status).toBe(500);
  });

  it('raises GetPet5XXError for range-matched 503', async () => {
    await generateAndRead(verifier, tree, errorSpec);
    const res = await callGeneratedClient(
      verifier,
      'get_pet',
      { pet_id: 1 },
      { status: 503, json: { code: 9, message: 'unavailable' } },
    );
    expect(res.ok).toBe(false);
    expect(res.exception?.error_type).toBe('GetPet5XXError');
    expect(res.exception?.status).toBe(503);
  });

  it('falls through to GetPetDefaultError for undeclared status codes', async () => {
    await generateAndRead(verifier, tree, errorSpec);
    const res = await callGeneratedClient(
      verifier,
      'get_pet',
      { pet_id: 1 },
      { status: 418, json: { message: 'teapot' } },
    );
    expect(res.ok).toBe(false);
    expect(res.exception?.error_type).toBe('GetPetDefaultError');
    expect(res.exception?.status).toBe(418);
  });

  it('async client raises the same typed exception', async () => {
    await generateAndRead(verifier, tree, errorSpec);
    const res = await callGeneratedClientAsync(
      verifier,
      'get_pet',
      { pet_id: 1 },
      { status: 404, json: { detail: 'gone' } },
    );
    expect(res.ok).toBe(false);
    expect(res.exception?.type).toBe('GetPetApiError');
    expect(res.exception?.error_type).toBe('GetPet404Error');
  });
});
