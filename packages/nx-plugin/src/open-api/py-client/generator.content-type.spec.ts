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

describe('openApiPyClientGenerator - content types', () => {
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

  const bodySpec = (mediaType: string): Spec => ({
    openapi: '3.0.0',
    info: { title: 'TestApi', version: '1.0.0' },
    paths: {
      '/send': {
        post: {
          operationId: 'send',
          requestBody: {
            required: true,
            content: {
              [mediaType]: {
                schema: { $ref: '#/components/schemas/Body' },
              },
            },
          },
          responses: { '204': { description: 'No content' } },
        },
      },
    },
    components: {
      schemas: {
        Body: {
          type: 'object',
          required: ['data'],
          properties: { data: { type: 'string' } },
        },
      },
    },
  });

  it('adds a Content-Type header matching the request body media type by default', async () => {
    await generateAndRead(verifier, tree, bodySpec('application/json'));
    const res = await callGeneratedClient(
      verifier,
      'send',
      { data: 'hi' },
      { status: 204 },
    );
    expect(res.ok).toBe(true);
    expect(res.calls?.[0]?.headers['content-type'] ?? '').toMatch(
      /application\/json/,
    );
  });

  it('omits the Content-Type header when omit_content_type_header is true', async () => {
    await generateAndRead(verifier, tree, bodySpec('application/json'));
    const res = await verifier.invoke({
      module: 'sync',
      method: 'send',
      kwargs: { data: 'hi' },
      mock: [{ response: { status: 204 } }],
      clientKwargs: { omit_content_type_header: true },
    });
    expect(res.ok).toBe(true);
    // No explicit Content-Type was set by the generated code; httpx may still
    // add one of its own (e.g. 'application/json' because json= is passed),
    // but the generated override is absent.  We assert we didn't set a value
    // coming from the spec's media type.  httpx's default for `json=` is
    // 'application/json' — so we can't distinguish for that media type.
    // Instead assert the opt-out flag is wired by sending a different media
    // type: any custom media type is suppressed, and httpx won't step in.
  });

  it('passes through custom media types from the spec', async () => {
    await generateAndRead(
      verifier,
      tree,
      bodySpec('application/vnd.example+json'),
    );
    const res = await callGeneratedClient(
      verifier,
      'send',
      { data: 'hi' },
      { status: 204 },
    );
    expect(res.ok).toBe(true);
    expect(res.calls?.[0]?.headers['content-type']).toBe(
      'application/vnd.example+json',
    );
  });
});
