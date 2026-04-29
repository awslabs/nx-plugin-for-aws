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

describe('openApiPyClientGenerator - deprecated / readOnly / cookies / multi-header', () => {
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

  it('emits warnings.warn(DeprecationWarning) for deprecated operations', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/old': {
          get: {
            operationId: 'oldOp',
            deprecated: true,
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
    expect(client).toContain('warnings.warn');
    expect(client).toContain('DeprecationWarning');
  });

  it('emits Field(frozen=True) + Field(description=...) for readOnly properties', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
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
                    schema: { $ref: '#/components/schemas/Frozen' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Frozen: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'string', readOnly: true, description: 'Opaque id' },
            },
          },
        },
      },
    };
    const { types } = await generateAndRead(verifier, tree, spec);
    expect(types).toContain('frozen=True');
    expect(types).toContain('description="Opaque id"');
  });

  it('handles cookie parameters', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/me': {
          get: {
            operationId: 'me',
            parameters: [
              {
                name: 'session',
                in: 'cookie',
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
    };
    await generateAndRead(verifier, tree, spec);
    const res = await callGeneratedClient(
      verifier,
      'me',
      { session: 'abc123' },
      { json: 'ok' },
    );
    expect(res.ok).toBe(true);
    const cookieHeader =
      res.calls?.[0]?.headers['cookie'] ??
      res.calls?.[0]?.headers['Cookie'] ??
      '';
    expect(cookieHeader).toContain('session=abc123');
  });

  it('emits multiple header entries for multi-valued header parameters (explode=true)', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/trace': {
          get: {
            operationId: 'trace',
            parameters: [
              {
                name: 'x-trace',
                in: 'header',
                required: true,
                explode: true,
                schema: { type: 'array', items: { type: 'string' } },
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
    };
    await generateAndRead(verifier, tree, spec);
    const res = await callGeneratedClient(
      verifier,
      'trace',
      { x_trace: ['a', 'b'] },
      { json: 'ok' },
    );
    expect(res.ok).toBe(true);
    // httpx flattens duplicate headers into a comma-separated string in
    // its dict view — we just verify both values made it onto the wire.
    const traceHeader = res.calls?.[0]?.headers['x-trace'] ?? '';
    expect(traceHeader).toMatch(/a/);
    expect(traceHeader).toMatch(/b/);
  });
});
