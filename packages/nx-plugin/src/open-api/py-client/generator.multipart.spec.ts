/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { PythonVerifier } from '../../utils/test/py.spec';
import type { Spec } from '../utils/types';
import {
  callGeneratedClient,
  callGeneratedClientAsync,
  createTree,
  expectSingleRequest,
  generateAndRead,
} from './generator.utils.spec';

/**
 * Multipart bodies, asserted against the encoded request: httpx accepts only
 * primitives in `data=`, so a structured or binary part that isn't routed
 * correctly either raises or lands on the wire as a Python `repr`.
 */
const spec: Spec = {
  openapi: '3.0.3',
  info: { title: 'MultipartApi', version: '1.0.0' },
  paths: {
    '/upload': {
      post: {
        operationId: 'upload',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: {
                  file: { type: 'string', format: 'binary' },
                  meta: {
                    type: 'object',
                    properties: { name: { type: 'string' } },
                  },
                  tags: { type: 'array', items: { type: 'string' } },
                  count: { type: 'integer' },
                  flag: { type: 'boolean' },
                },
              },
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
    '/upload-many': {
      post: {
        operationId: 'uploadMany',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['files'],
                properties: {
                  files: {
                    type: 'array',
                    items: { type: 'string', format: 'binary' },
                  },
                  note: { type: 'string' },
                },
              },
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
    '/upload-typed': {
      post: {
        operationId: 'uploadTyped',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['payload'],
                properties: {
                  payload: {
                    type: 'object',
                    properties: { id: { type: 'integer' } },
                  },
                },
              },
              encoding: { payload: { contentType: 'application/json' } },
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
};

/**
 * The parts of the recorded multipart body, keyed by part name. A part is
 * headers then a blank line then its content, up to the next boundary.
 */
const partsOf = (body: string | null): Record<string, string> => {
  const parts: Record<string, string> = {};
  for (const chunk of (body ?? '').split(/--[0-9a-f]{16,}/)) {
    const match = /name="([^"]+)"[\s\S]*?\r\n\r\n([\s\S]*?)\r\n$/.exec(chunk);
    if (match) {
      parts[match[1]] = match[2];
    }
  }
  return parts;
};

describe('openApiPyClientGenerator - multipart bodies', () => {
  let tree: Tree;
  let verifier: PythonVerifier;

  beforeAll(() => {
    verifier = new PythonVerifier();
  });

  afterAll(async () => {
    await verifier.shutdown();
  });

  beforeEach(async () => {
    tree = createTree();
    await generateAndRead(verifier, tree, spec);
  });

  it('sends a binary field as a file part', async () => {
    const res = await callGeneratedClient(
      verifier,
      'upload',
      { file: 'file bytes' },
      { json: 'ok' },
    );
    expect(res.ok).toBe(true);
    const call = expectSingleRequest(res);
    expect(call.headers['content-type']).toMatch(
      /^multipart\/form-data; boundary=/,
    );
    expect(partsOf(call.body).file).toBe('file bytes');
  });

  // httpx rejects a dict in `data=`, so an object part must be JSON encoded.
  it('JSON encodes an object field with no declared content type', async () => {
    const res = await callGeneratedClient(
      verifier,
      'upload',
      { file: 'f', meta: { name: 'x' } },
      { json: 'ok' },
    );
    expect(res.ok).toBe(true);
    expect(partsOf(expectSingleRequest(res).body).meta).toBe('{"name":"x"}');
  });

  it('sends each element of an array field as its own part', async () => {
    const res = await callGeneratedClient(
      verifier,
      'upload',
      { file: 'f', tags: ['a', 'b'] },
      { json: 'ok' },
    );
    expect(res.ok).toBe(true);
    const body = expectSingleRequest(res).body ?? '';
    expect(body.match(/name="tags"/g)).toHaveLength(2);
    expect(body).toContain('\r\n\r\na\r\n');
    expect(body).toContain('\r\n\r\nb\r\n');
  });

  // A Python `repr` of the bytes would corrupt every byte, and without a file
  // part httpx would not even send a multipart body.
  it('sends an array of binary fields as one file part per element', async () => {
    const res = await callGeneratedClient(
      verifier,
      'upload_many',
      { files: ['first', 'second'], note: 'hi' },
      { json: 'ok' },
    );
    expect(res.ok).toBe(true);
    const call = expectSingleRequest(res);
    expect(call.headers['content-type']).toMatch(
      /^multipart\/form-data; boundary=/,
    );
    expect(call.body).toContain('first');
    expect(call.body).toContain('second');
    expect(call.body).not.toContain("b'first'");
    expect(partsOf(call.body).note).toBe('hi');
  });

  it('serialises scalar fields in their wire form', async () => {
    const res = await callGeneratedClient(
      verifier,
      'upload',
      { file: 'f', count: 3, flag: true },
      { json: 'ok' },
    );
    const parts = partsOf(expectSingleRequest(res).body);
    expect(parts.count).toBe('3');
    expect(parts.flag).toBe('true');
  });

  it('honours a per-part content type from the encoding object', async () => {
    const res = await callGeneratedClient(
      verifier,
      'upload_typed',
      { payload: { id: 1 } },
      { json: 'ok' },
    );
    expect(res.ok).toBe(true);
    const body = expectSingleRequest(res).body ?? '';
    expect(body).toContain('Content-Type: application/json');
    expect(body).toContain('{"id":1}');
  });

  it('encodes the same body through the async client', async () => {
    const res = await callGeneratedClientAsync(
      verifier,
      'upload',
      { file: 'f', meta: { name: 'x' } },
      { json: 'ok' },
    );
    expect(res.ok).toBe(true);
    expect(partsOf(expectSingleRequest(res).body).meta).toBe('{"name":"x"}');
  });
});
