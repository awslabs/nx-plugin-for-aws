/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import type { Spec } from '../utils/types.js';
import { openApiPyClientGenerator } from './generator.js';
import {
  callGeneratedClient,
  callGeneratedClientAsync,
  createPythonClientVerifier,
  createTree,
  expectSingleRequest,
  generateAndRead,
  outputPath,
} from './generator.utils.spec.js';

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
  const verifier = createPythonClientVerifier();

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

  /**
   * FastAPI writes a `bytes` body as `{type: 'string', contentMediaType: ...}`
   * rather than `format: binary`. The promotion to binary was scoped to form
   * media types and walked only one level of `properties`, so a whole binary body
   * stayed a `str` and was sent as `repr(bytes)`, and a `list[UploadFile]` was
   * typed `list[str]` and sent as text parts the server refused.
   */
  describe('OpenAPI 3.1 binary bodies', () => {
    const binarySpec = (schema: unknown, mediaType: string): Spec =>
      ({
        openapi: '3.1.0',
        info: { title: 'TestApi', version: '1.0.0' },
        paths: {
          '/upload': {
            post: {
              operationId: 'upload',
              requestBody: {
                required: true,
                content: { [mediaType]: { schema } },
              },
              responses: { '204': { description: 'No content' } },
            },
          },
        },
      }) as unknown as Spec;

    it('types a whole binary body as bytes', async () => {
      const { client } = await generateAndRead(
        verifier,
        tree,
        binarySpec(
          { type: 'string', contentMediaType: 'application/octet-stream' },
          'application/octet-stream',
        ),
      );
      expect(client).toContain('body: bytes');
      // `str(body)` would put `b'\x00'` on the wire.
      expect(client).not.toMatch(
        /\{"content": None if body is None else str\(body\)\}/,
      );
    });

    it('types a list of file fields as bytes', async () => {
      const { client } = await generateAndRead(
        verifier,
        tree,
        binarySpec(
          {
            type: 'object',
            required: ['files'],
            properties: {
              files: {
                type: 'array',
                items: {
                  type: 'string',
                  contentMediaType: 'application/octet-stream',
                },
              },
            },
          },
          'multipart/form-data',
        ),
      );
      expect(client).toContain('files: list[bytes]');
    });

    it('types an optional file field as bytes', async () => {
      const { types } = await generateAndRead(
        verifier,
        tree,
        binarySpec(
          {
            type: 'object',
            properties: {
              file: {
                anyOf: [
                  {
                    type: 'string',
                    contentMediaType: 'application/octet-stream',
                  },
                  { type: 'null' },
                ],
              },
            },
          },
          'multipart/form-data',
        ),
      );
      expect(types).toContain('bytes | None');
    });
  });

  // An enum is a single value on the wire but is not `isPrimitive`, so it was
  // JSON-encoded and arrived quoted under its declared non-JSON Content-Type.
  it('sends an enum body verbatim under a non-JSON media type', async () => {
    const { client } = await generateAndRead(verifier, tree, {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/c': {
          post: {
            operationId: 'setColour',
            requestBody: {
              required: true,
              content: {
                'text/plain': {
                  schema: { $ref: '#/components/schemas/Colour' },
                },
              },
            },
            responses: { '204': { description: 'No content' } },
          },
        },
      },
      components: {
        schemas: { Colour: { type: 'string', enum: ['red', 'blue'] } },
      },
    });
    // Formatting may wrap the dict, so assert the expression, not the line.
    expect(client).toContain('"content": None if body is None else str(body)');
    expect(client).not.toContain('{"json": body}');
  });

  // A structured body under a media type that is neither JSON nor a form has no
  // defined encoding; it was sent as JSON bytes under the declared header.
  it('rejects a structured body under a non-JSON media type', async () => {
    tree.write(
      'openapi.json',
      JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'TestApi', version: '1.0.0' },
        paths: {
          '/p': {
            post: {
              operationId: 'send',
              requestBody: {
                required: true,
                content: {
                  'text/plain': {
                    schema: {
                      type: 'object',
                      required: ['a'],
                      properties: { a: { type: 'string' } },
                    },
                  },
                },
              },
              responses: { '204': { description: 'No content' } },
            },
          },
        },
      }),
    );
    await expect(
      openApiPyClientGenerator(tree, {
        openApiSpecPath: 'openapi.json',
        outputPath,
      }),
    ).rejects.toThrow(/no defined encoding for that media type/);
  });

  // `json=None` makes httpx omit the body entirely, which a server cannot tell
  // from no body at all — but a required nullable body means the JSON `null`.
  it('sends null for a required nullable body', async () => {
    const { client } = await generateAndRead(verifier, tree, {
      openapi: '3.1.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/n': {
          post: {
            operationId: 'setPayload',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    anyOf: [
                      { $ref: '#/components/schemas/Payload' },
                      { type: 'null' },
                    ],
                  },
                },
              },
            },
            responses: { '204': { description: 'No content' } },
          },
        },
      },
      components: {
        schemas: {
          Payload: {
            type: 'object',
            required: ['a'],
            properties: { a: { type: 'string' } },
          },
        },
      },
    } as unknown as Spec);
    expect(client).toContain(
      '{"content": b"null"} if body is None else {"json": body}',
    );
  });

  // A whole binary body is sent as raw content even under a form media type, so
  // it sets the Content-Type httpx would otherwise derive from the multipart body
  // it is not building. The flag that writes that header is also what declares
  // `header_params`, and excluding every multipart body left the assignment out
  // while the write stayed — a `NameError` on every call, which `ast.parse`
  // cannot see and only the type check caught.
  it('declares header_params for a binary body under a form media type', async () => {
    const { client } = await generateAndRead(verifier, tree, {
      openapi: '3.0.0',
      info: { title: 'TestApi', version: '1.0.0' },
      paths: {
        '/upload': {
          post: {
            operationId: 'upload',
            tags: ['files'],
            requestBody: {
              required: true,
              content: {
                'multipart/form-data': {
                  schema: { type: 'string', format: 'binary' },
                },
              },
            },
            responses: { '204': { description: 'No content' } },
          },
        },
      },
    });
    // The declaration precedes the write, and the dict reaches `_headers`.
    expect(client).toContain('header_params: dict[str, Any] = {}');
    expect(client).toContain(
      '_default_content_type(header_params, "multipart/form-data")',
    );
    expect(client).toContain('headers=self._headers(header_params)');
  });
});
