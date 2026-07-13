/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { expectTypeScriptToCompile } from '../../utils/test/ts.spec';
import type { Spec } from '../utils/types';
import { openApiTsClientGenerator } from './generator';
import { baseUrl, callGeneratedClient } from './generator.utils.spec';

describe('openApiTsClientGenerator - FastAPI gaps', () => {
  let tree: Tree;
  const title = 'TestApi';

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const validateTypeScript = (paths: string[]) => {
    expectTypeScriptToCompile(tree, paths);
  };

  const generate = async (spec: Spec) => {
    tree.write('openapi.json', JSON.stringify(spec));
    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });
    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
    ]);
    return {
      types: tree.read('src/generated/types.gen.ts', 'utf-8')!,
      client: tree.read('src/generated/client.gen.ts', 'utf-8')!,
    };
  };

  describe('urlencoded form bodies', () => {
    // FastAPI Form(...) endpoints declare application/x-www-form-urlencoded.
    const spec: Spec = {
      info: { title, version: '1.0.0' },
      openapi: '3.1.0',
      paths: {
        '/login': {
          post: {
            operationId: 'login',
            requestBody: {
              required: true,
              content: {
                'application/x-www-form-urlencoded': {
                  schema: {
                    type: 'object',
                    required: ['username', 'password'],
                    properties: {
                      username: { type: 'string' },
                      password: { type: 'string' },
                      remember: { type: 'boolean' },
                      scopes: { type: 'array', items: { type: 'string' } },
                    },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['username'],
                      properties: { username: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    it('should send urlencoded key=value pairs, not JSON', async () => {
      const { types, client } = await generate(spec);
      expect(types).toMatchSnapshot('types.gen.ts');
      expect(client).toMatchSnapshot('client.gen.ts');

      const mockFetch = vi.fn();
      mockFetch.mockResolvedValue({
        status: 200,
        json: vi.fn().mockResolvedValue({ username: 'alice' }),
      });

      expect(
        await callGeneratedClient(client, mockFetch, 'login', {
          username: 'alice',
          password: 'p&w=1',
          remember: true,
          scopes: ['read', 'write'],
        }),
      ).toEqual({ username: 'alice' });

      const [url, request] = mockFetch.mock.calls[0];
      expect(url).toBe(`${baseUrl}/login`);
      expect(request.headers).toContainEqual([
        'Content-Type',
        'application/x-www-form-urlencoded',
      ]);
      // Not JSON — URLSearchParams encoding, arrays as repeated keys.
      expect(request.body).toBe(
        'username=alice&password=p%26w%3D1&remember=true&scopes=read&scopes=write',
      );
    });

    it('should omit undefined optional fields from the form body', async () => {
      const { client } = await generate(spec);
      const mockFetch = vi.fn();
      mockFetch.mockResolvedValue({
        status: 200,
        json: vi.fn().mockResolvedValue({ username: 'alice' }),
      });
      await callGeneratedClient(client, mockFetch, 'login', {
        username: 'alice',
        password: 'pw',
      });
      expect(mockFetch.mock.calls[0][1].body).toBe(
        'username=alice&password=pw',
      );
    });
  });

  describe('tuples (3.1 prefixItems)', () => {
    // Pydantic emits prefixItems for tuple[A, B] fields.
    const spec: Spec = {
      info: { title, version: '1.0.0' },
      openapi: '3.1.0',
      paths: {
        '/tuples': {
          get: {
            operationId: 'getTuples',
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/TupleOutput' },
                  },
                },
              },
            },
          },
          post: {
            operationId: 'putTuples',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/TupleOutput' },
                },
              },
            },
            responses: { '204': { description: 'ok' } },
          },
        },
      },
      components: {
        schemas: {
          TupleOutput: {
            type: 'object',
            required: ['pair', 'stamped', 'points'],
            properties: {
              pair: {
                type: 'array',
                prefixItems: [{ type: 'integer' }, { type: 'string' }],
                minItems: 2,
                maxItems: 2,
              },
              stamped: {
                type: 'array',
                prefixItems: [
                  { type: 'string' },
                  { type: 'string', format: 'date-time' },
                ],
                minItems: 2,
                maxItems: 2,
              },
              points: {
                type: 'array',
                items: {
                  type: 'array',
                  prefixItems: [{ type: 'number' }, { type: 'number' }],
                  minItems: 2,
                  maxItems: 2,
                },
              },
            },
          } as any,
        },
      },
    };

    it('should type tuples positionally and revive dates inside them', async () => {
      const { types, client } = await generate(spec);
      expect(types).toMatchSnapshot('types.gen.ts');
      expect(client).toMatchSnapshot('client.gen.ts');

      expect(types).toContain('pair: [number, string];');
      expect(types).toContain('stamped: [string, Date];');
      expect(types).toContain('points: Array<[number, number]>;');

      const mockFetch = vi.fn();
      mockFetch.mockResolvedValue({
        status: 200,
        json: vi.fn().mockResolvedValue({
          pair: [42, 'answer'],
          stamped: ['created', '2026-01-02T03:04:05Z'],
          points: [
            [1, 2],
            [3, 4],
          ],
        }),
      });

      const result = await callGeneratedClient(client, mockFetch, 'getTuples');
      expect(result.pair).toEqual([42, 'answer']);
      expect(result.stamped[0]).toBe('created');
      expect(result.stamped[1]).toEqual(new Date('2026-01-02T03:04:05Z'));
      expect(result.points).toEqual([
        [1, 2],
        [3, 4],
      ]);
    });

    it('should serialise dates inside tuples in the request body', async () => {
      const { client } = await generate(spec);
      const mockFetch = vi.fn();
      mockFetch.mockResolvedValue({ status: 204 });

      await callGeneratedClient(client, mockFetch, 'putTuples', {
        pair: [42, 'answer'],
        stamped: ['created', new Date('2026-01-02T03:04:05Z')],
        points: [[1, 2]],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toEqual({
        pair: [42, 'answer'],
        stamped: ['created', '2026-01-02T03:04:05.000Z'],
        points: [[1, 2]],
      });
    });

    it('should treat a tuple with additional items as a plain array', async () => {
      const { types } = await generate({
        info: { title, version: '1.0.0' },
        openapi: '3.1.0',
        paths: {
          '/open-tuple': {
            get: {
              operationId: 'getOpenTuple',
              responses: {
                '200': {
                  description: 'ok',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        required: ['value'],
                        properties: {
                          value: {
                            type: 'array',
                            prefixItems: [{ type: 'string' }],
                            items: { type: 'number' },
                          } as any,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
      expect(types).toContain('value: Array<number>;');
    });
  });

  describe('JSON-encoded primitive responses', () => {
    // FastAPI returns primitives JSON-encoded on an application/json wire:
    // a string body is `"hello"` (quotes included), a datetime is `"...Z"`.
    const spec: Spec = {
      info: { title, version: '1.0.0' },
      openapi: '3.1.0',
      paths: {
        '/plain-str': {
          get: {
            operationId: 'plainStr',
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': { schema: { type: 'string' } },
                },
              },
            },
          },
        },
        '/plain-stamp': {
          get: {
            operationId: 'plainStamp',
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
        '/plain-text': {
          get: {
            operationId: 'plainText',
            responses: {
              '200': {
                description: 'ok',
                content: { 'text/plain': { schema: { type: 'string' } } },
              },
            },
          },
        },
      },
    };

    it('should JSON-parse primitives on a JSON wire and keep text/plain raw', async () => {
      const { types, client } = await generate(spec);
      expect(types).toMatchSnapshot('types.gen.ts');
      expect(client).toMatchSnapshot('client.gen.ts');

      const mockFetch = vi.fn();
      mockFetch.mockResolvedValue({
        status: 200,
        json: vi.fn().mockResolvedValue('hello world'),
        text: vi.fn().mockResolvedValue('raw text'),
      });

      // application/json: the value comes from response.json() (unquoted).
      expect(await callGeneratedClient(client, mockFetch, 'plainStr')).toBe(
        'hello world',
      );
      // text/plain keeps raw text semantics.
      expect(await callGeneratedClient(client, mockFetch, 'plainText')).toBe(
        'raw text',
      );

      mockFetch.mockResolvedValue({
        status: 200,
        json: vi.fn().mockResolvedValue('2026-01-02T03:04:05Z'),
      });
      const stamp = await callGeneratedClient(client, mockFetch, 'plainStamp');
      expect(stamp).toEqual(new Date('2026-01-02T03:04:05Z'));
    });
  });
});
