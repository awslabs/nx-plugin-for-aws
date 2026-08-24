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

describe('openApiPyClientGenerator - content types', () => {
  let tree: Tree;
  const verifier = createPythonClientVerifier();

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

  // Asserted with a custom media type: httpx sets `application/json` itself for
  // a `json=` body, which would mask the flag for that media type. Any other
  // declared type can only come from the generated code, so its absence proves
  // the opt-out is wired.
  it('omits the Content-Type header when omit_content_type_header is true', async () => {
    const spec = bodySpec('application/vnd.example+json');
    await generateAndRead(verifier, tree, spec);

    const sent = await callGeneratedClient(
      verifier,
      'send',
      { data: 'hi' },
      { status: 204 },
    );
    expect(sent.calls?.[0]?.headers['content-type'] ?? '').toBe(
      'application/vnd.example+json',
    );

    const omitted = await verifier.invoke({
      module: 'sync',
      method: 'send',
      kwargs: { data: 'hi' },
      mock: [{ response: { status: 204 } }],
      clientKwargs: { omit_content_type_header: true },
    });
    expect(omitted.ok).toBe(true);
    expect(omitted.calls?.[0]?.headers['content-type'] ?? '').not.toContain(
      'vnd.example',
    );
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

  it('routes multipart/form-data bodies through httpx `files=`/`data=`', async () => {
    // Regression: multipart bodies used to emit `body: types.unknown`
    // (non-existent type) with a JSON-encoded body.  They must produce a
    // single `body` kwarg whose contents are routed through httpx's
    // multipart machinery so the wire payload is actually multipart.
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/files': {
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
                      description: { type: 'string' },
                    },
                  },
                },
              },
            },
            responses: { '204': { description: 'No content' } },
          },
        },
      },
    };
    const { client } = await generateAndRead(verifier, tree, spec);
    // Must not reference the phantom `types.unknown`/`types.Unknown`.
    expect(client).not.toMatch(/types\.[Uu]nknown/);
    // Must not JSON-encode a multipart body.
    expect(client).not.toMatch(/"json": body[\s\S]*?multipart\/form-data/);
    // Must route the body through `files=`/`data=` (the multipart branch).
    expect(client).toMatch(/"files":\s*_files/);

    // Pass string field values — the worker round-trips args through JSON
    // so bytes don't survive the transport.  httpx downgrades a "no files"
    // multipart payload to `application/x-www-form-urlencoded`, which is
    // still the wire-correct "form body" category; the thing we're
    // regressing against is the body being JSON-encoded.
    const res = await callGeneratedClient(
      verifier,
      'upload',
      { file: 'hi', description: 'desc' },
      { status: 204 },
    );
    expect(res.ok).toBe(true);
    const contentType = res.calls?.[0]?.headers['content-type'] ?? '';
    expect(contentType).toMatch(
      /^(multipart\/form-data; boundary=|application\/x-www-form-urlencoded)/,
    );
    const body = res.calls?.[0]?.body ?? '';
    expect(body).not.toMatch(/^\s*\{/); // not JSON
  });
});
