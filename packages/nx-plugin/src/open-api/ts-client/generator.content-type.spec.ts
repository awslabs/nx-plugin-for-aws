/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Tree } from '@nx/devkit';
import { importTypeScriptModule } from '../../utils/js';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { expectTypeScriptToCompile } from '../../utils/test/ts.spec';
import type { Spec } from '../utils/types';
import { openApiTsClientGenerator } from './generator';
import { baseUrl, callGeneratedClient } from './generator.utils.spec';

describe('openApiTsClientGenerator - content type header', () => {
  let tree: Tree;
  const title = 'TestApi';

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const validateTypeScript = (paths: string[]) => {
    expectTypeScriptToCompile(tree, paths);
  };

  it('should add the appropriate content type header by default', async () => {
    const spec: Spec = {
      info: {
        title,
        version: '1.0.0',
      },
      openapi: '3.0.0',
      paths: {
        '/json': {
          post: {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: {
                        type: 'string',
                      },
                    },
                  },
                },
              },
            },
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: {
                        type: 'string',
                      },
                    },
                  },
                },
                description: 'Success',
              },
            },
          },
        },
        '/text': {
          post: {
            requestBody: {
              required: true,
              content: {
                'text/plain': {
                  schema: {
                    type: 'string',
                  },
                },
              },
            },
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: {
                        type: 'string',
                      },
                    },
                  },
                },
                description: 'Success',
              },
            },
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
    ]);

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');

    const mockFetch = vi.fn();

    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue(['a', 'b', 'c']),
    });

    expect(
      await callGeneratedClient(client, mockFetch, 'postJson', {
        message: 'hi',
      }),
    ).toEqual(['a', 'b', 'c']);
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/json`,
      expect.objectContaining({
        method: 'POST',
        headers: [['Content-Type', 'application/json']],
      }),
    );

    expect(
      await callGeneratedClient(client, mockFetch, 'postText', 'hello'),
    ).toEqual(['a', 'b', 'c']);
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/text`,
      expect.objectContaining({
        method: 'POST',
        headers: [['Content-Type', 'text/plain']],
      }),
    );
  });

  it('should allow omitting auto content type header', async () => {
    const spec: Spec = {
      info: {
        title,
        version: '1.0.0',
      },
      openapi: '3.0.0',
      paths: {
        '/json': {
          post: {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: {
                        type: 'string',
                      },
                    },
                  },
                },
              },
            },
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: {
                        type: 'string',
                      },
                    },
                  },
                },
                description: 'Success',
              },
            },
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
    ]);

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');

    const mockFetch = vi.fn();

    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue(['a', 'b', 'c']),
    });

    const { TestApi } = await importTypeScriptModule<any>(client);
    const c = new TestApi({
      url: baseUrl,
      fetch: mockFetch,
      options: { omitContentTypeHeader: true },
    });

    expect(await c.postJson({ message: 'hi' })).toEqual(['a', 'b', 'c']);
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/json`,
      expect.objectContaining({
        method: 'POST',
        headers: [], // No content-type header added
      }),
    );
  });

  it('should pick a single wire media type when the spec lists multiple', async () => {
    // Regression: the generator used to emit the joined list
    // "application/json,application/xml,application/x-www-form-urlencoded"
    // as the Content-Type header.  Servers parse Content-Type as a single
    // type, so we pick the first JSON-compatible media type (or the first
    // entry) and emit it verbatim.
    const spec: Spec = {
      info: { title, version: '1.0.0' },
      openapi: '3.0.0',
      paths: {
        '/multi': {
          post: {
            requestBody: {
              required: true,
              content: {
                'application/xml': {
                  schema: {
                    type: 'object',
                    properties: { m: { type: 'string' } },
                  },
                },
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { m: { type: 'string' } },
                  },
                },
                'application/x-www-form-urlencoded': {
                  schema: {
                    type: 'object',
                    properties: { m: { type: 'string' } },
                  },
                },
              },
            },
            responses: { '204': { description: 'ok' } },
          },
        },
      },
    };
    tree.write('openapi.json', JSON.stringify(spec));
    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });
    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
    ]);
    const types = tree.read('src/generated/types.gen.ts', 'utf-8')!;
    const client = tree.read('src/generated/client.gen.ts', 'utf-8')!;
    expect(types).toMatchSnapshot('types.gen.ts');
    expect(client).toMatchSnapshot('client.gen.ts');
    // Not the joined list.
    expect(client).not.toMatch(
      /'application\/json,application\/xml,application\/x-www-form-urlencoded'/,
    );
    // One declared value, the JSON-compatible one preferred.
    expect(client).toContain(
      "headerParameters['Content-Type'] = 'application/json'",
    );
  });

  it('should not force Content-Type for multipart/form-data bodies', async () => {
    // Regression: setting Content-Type to a bare `multipart/form-data` string
    // strips the boundary param that `fetch` would otherwise autocompute from
    // a FormData body, so the server cannot parse the payload.
    const spec: Spec = {
      info: { title, version: '1.0.0' },
      openapi: '3.0.0',
      paths: {
        '/upload': {
          post: {
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
            responses: { '204': { description: 'ok' } },
          },
        },
      },
    };
    tree.write('openapi.json', JSON.stringify(spec));
    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });
    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
    ]);
    const types = tree.read('src/generated/types.gen.ts', 'utf-8')!;
    const client = tree.read('src/generated/client.gen.ts', 'utf-8')!;
    expect(types).toMatchSnapshot('types.gen.ts');
    expect(client).toMatchSnapshot('client.gen.ts');
    expect(client).not.toMatch(
      /headerParameters\['Content-Type'\]\s*=\s*'multipart\/form-data'/,
    );
  });

  it('should serialise cookie parameters into a Cookie request header', async () => {
    // Regression: cookie parameters used to be typed on the request input
    // but silently dropped at send time — the user's session cookie never
    // reached the server.
    const spec: Spec = {
      info: { title, version: '1.0.0' },
      openapi: '3.0.0',
      paths: {
        '/secret': {
          get: {
            operationId: 'getSecret',
            parameters: [
              { name: 'session', in: 'cookie', schema: { type: 'string' } },
              { name: 'preference', in: 'cookie', schema: { type: 'string' } },
            ],
            responses: {
              '200': {
                content: { 'application/json': { schema: { type: 'string' } } },
                description: 'ok',
              },
            },
          },
        },
      },
    };
    tree.write('openapi.json', JSON.stringify(spec));
    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });
    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
    ]);
    const types = tree.read('src/generated/types.gen.ts', 'utf-8')!;
    const client = tree.read('src/generated/client.gen.ts', 'utf-8')!;
    expect(types).toMatchSnapshot('types.gen.ts');
    expect(client).toMatchSnapshot('client.gen.ts');
    expect(client).toContain('RequestCookieParameters.toJson(input)');
    expect(client).toContain("headerParameters['Cookie']");

    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue('sekret'),
      json: vi.fn().mockResolvedValue('sekret'),
    });
    expect(
      await callGeneratedClient(client, mockFetch, 'getSecret', {
        session: 's=1; path=/',
        preference: 'dark mode',
      }),
    ).toBe('sekret');

    const headers = (mockFetch.mock.calls[0][1] as any).headers as [
      string,
      string,
    ][];
    const cookieHeader = headers.find(([k]) => k === 'Cookie')?.[1];
    expect(cookieHeader).toBeDefined();
    // Both cookies, percent-encoded, joined with `; `.
    expect(cookieHeader).toContain('session=s%3D1%3B%20path%3D%2F');
    expect(cookieHeader).toContain('preference=dark%20mode');
  });

  it('should send a primitive urlencoded body verbatim and form-encode an object body', async () => {
    const arrayResponse = {
      '200': {
        content: {
          'application/json': {
            schema: { type: 'array', items: { type: 'string' } },
          },
        },
        description: 'Success',
      },
    };
    const spec: Spec = {
      info: {
        title,
        version: '1.0.0',
      },
      openapi: '3.0.0',
      paths: {
        // A raw @httpPayload string body: the schema is a primitive, so the
        // body must be sent verbatim rather than passed to $urlEncodedForm
        // (which expects an object and would fail to type-check).
        '/urlencoded-string': {
          post: {
            requestBody: {
              required: true,
              content: {
                'application/x-www-form-urlencoded': {
                  schema: { type: 'string' },
                },
              },
            },
            responses: arrayResponse,
          },
        },
        // An object body is still form-encoded to `key=value` pairs.
        '/urlencoded-object': {
          post: {
            requestBody: {
              required: true,
              content: {
                'application/x-www-form-urlencoded': {
                  schema: {
                    type: 'object',
                    properties: { token: { type: 'string' } },
                  },
                },
              },
            },
            responses: arrayResponse,
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    // The regression guard: a primitive-string urlencoded body used to be
    // passed to $urlEncodedForm (typed for an object), so the client failed to
    // compile.
    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
    ]);

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');

    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue(['ok']),
    });

    // The string body is sent verbatim, with the urlencoded content type kept.
    await callGeneratedClient(
      client,
      mockFetch,
      'postUrlencodedString',
      'some-token=abc123',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/urlencoded-string`,
      expect.objectContaining({
        method: 'POST',
        body: 'some-token=abc123',
        headers: [['Content-Type', 'application/x-www-form-urlencoded']],
      }),
    );

    // The object body is form-encoded to `key=value` pairs.
    await callGeneratedClient(client, mockFetch, 'postUrlencodedObject', {
      token: 'abc 123',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/urlencoded-object`,
      expect.objectContaining({
        method: 'POST',
        body: 'token=abc+123',
        headers: [['Content-Type', 'application/x-www-form-urlencoded']],
      }),
    );
  });

  it('should form-encode a urlencoded dictionary (additionalProperties) body', async () => {
    const spec: Spec = {
      info: { title, version: '1.0.0' },
      openapi: '3.0.0',
      paths: {
        '/urlencoded-dict': {
          post: {
            requestBody: {
              required: true,
              content: {
                'application/x-www-form-urlencoded': {
                  schema: {
                    type: 'object',
                    additionalProperties: { type: 'string' },
                  },
                },
              },
            },
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { type: 'array', items: { type: 'string' } },
                  },
                },
                description: 'Success',
              },
            },
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
    ]);

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue(['ok']),
    });

    // Each dictionary entry becomes a form field.
    await callGeneratedClient(client, mockFetch, 'postUrlencodedDict', {
      first: 'a b',
      second: 'c&d',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/urlencoded-dict`,
      expect.objectContaining({
        method: 'POST',
        body: 'first=a+b&second=c%26d',
        headers: [['Content-Type', 'application/x-www-form-urlencoded']],
      }),
    );
  });

  it('should throw for a urlencoded body whose schema is an array', async () => {
    // A top-level array has no property names to key on, so it has no defined
    // form encoding — fail fast rather than emit index-keyed pairs (0=a&1=b)
    // that no form parser can decode.
    const spec: Spec = {
      info: { title, version: '1.0.0' },
      openapi: '3.0.0',
      paths: {
        '/urlencoded-array': {
          post: {
            requestBody: {
              required: true,
              content: {
                'application/x-www-form-urlencoded': {
                  schema: { type: 'array', items: { type: 'string' } },
                },
              },
            },
            responses: { '204': { description: 'No content' } },
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await expect(
      openApiTsClientGenerator(tree, {
        openApiSpecPath: 'openapi.json',
        outputPath: 'src/generated',
      }),
    ).rejects.toThrow(/x-www-form-urlencoded.*array.*no defined form encoding/);
  });

  it('should not throw for an array body offering both JSON and urlencoded', async () => {
    // JSON is the preferred wire type, so the array body is sent as JSON — the
    // urlencoded offering is never used and must not trip the form-encoding guard.
    const spec: Spec = {
      info: { title, version: '1.0.0' },
      openapi: '3.0.0',
      paths: {
        '/array-json-or-form': {
          post: {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { type: 'array', items: { type: 'string' } },
                },
                'application/x-www-form-urlencoded': {
                  schema: { type: 'array', items: { type: 'string' } },
                },
              },
            },
            responses: { '204': { description: 'No content' } },
          },
        },
      },
    };

    tree.write('openapi.json', JSON.stringify(spec));

    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
    ]);

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({ status: 204 });

    await callGeneratedClient(client, mockFetch, 'postArrayJsonOrForm', [
      'a',
      'b',
    ]);
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/array-json-or-form`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(['a', 'b']),
        headers: [['Content-Type', 'application/json']],
      }),
    );
  });
});
