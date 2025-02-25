/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { expectTypeScriptToCompile } from './generator.utils.spec';
import { Mock } from 'vitest';
import { importTypeScriptModule } from '../../utils/js';
import { Spec } from '../utils/types';
import openApiTsClientGenerator from './generator';

describe('openApiTsClientGenerator - streaming', () => {
  let tree: Tree;
  const title = 'TestApi';
  const baseUrl = 'https://example.com';

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const validateTypeScript = (paths: string[]) => {
    expectTypeScriptToCompile(tree, paths);
  };

  const callGeneratedClientStreaming = async (
    clientModule: string,
    mockFetch: Mock<any, any>,
    op: string,
    parameters?: any,
  ): Promise<AsyncIterableIterator<any>> => {
    const { TestApi } = await importTypeScriptModule<any>(clientModule);
    const client = new TestApi({ url: baseUrl, fetch: mockFetch });
    const clientMethod = op.split('.').reduce((m, opPart) => m[opPart], client);
    return clientMethod(parameters);
  };

  const mockStreamingFetch = (
    status: number,
    chunks: any[],
  ): Mock<any, any> => {
    const mockFetch = vi.fn();

    let i = 0;

    const mockReader = vi.fn();
    mockReader.mockReturnValue({
      read: vi.fn().mockImplementation(() => {
        const value = chunks[i];
        const done = i >= chunks.length;
        i++;
        return {
          done,
          value,
        };
      }),
    });

    mockFetch.mockResolvedValue({
      status,
      body: {
        pipeThrough: () => ({
          getReader: mockReader,
        }),
        getReader: () => mockReader,
      },
    });

    return mockFetch;
  };

  it('should return an iterator over a stream of strings', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/test': {
          get: {
            // Mark as a streaming api
            ...{ 'x-streaming': true },
            operationId: 'getTest',
            responses: {
              '200': {
                description: 'getTest',
                content: {
                  'text/plain': {
                    schema: {
                      type: 'string',
                    },
                  },
                },
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

    const types = tree.read('src/generated/types.gen.ts', 'utf-8');
    expect(types).toMatchSnapshot();

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    expect(client).toMatchSnapshot();

    const mockFetch = mockStreamingFetch(200, ['some', 'text', 'chunks']);

    const receivedChunks: string[] = [];
    for await (const chunk of await callGeneratedClientStreaming(
      client,
      mockFetch,
      'getTest',
    )) {
      receivedChunks.push(chunk);
    }

    expect(receivedChunks).toEqual(['some', 'text', 'chunks']);
  });

  it('should return an iterator over a stream of objects', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/test': {
          get: {
            // Mark as a streaming api
            ...{ 'x-streaming': true },
            operationId: 'getTest',
            responses: {
              '200': {
                description: 'getTest',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        foo: {
                          type: 'string',
                        },
                        bar: {
                          type: 'number',
                        },
                      },
                      required: ['foo', 'bar'],
                    },
                  },
                },
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

    const types = tree.read('src/generated/types.gen.ts', 'utf-8');
    expect(types).toMatchSnapshot();

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    expect(client).toMatchSnapshot();

    const mockFetch = mockStreamingFetch(200, [
      '{ "foo": "foo1", "bar": 1 }',
      '{ "foo": "foo2", "bar": 2 }',
      '{ "foo": "foo3", "bar": 3 }',
    ]);

    const receivedChunks: { foo: string; bar: number }[] = [];
    for await (const chunk of await callGeneratedClientStreaming(
      client,
      mockFetch,
      'getTest',
    )) {
      receivedChunks.push(chunk);
    }

    expect(receivedChunks).toEqual([
      { foo: 'foo1', bar: 1 },
      { foo: 'foo2', bar: 2 },
      { foo: 'foo3', bar: 3 },
    ]);
  });

  it('should return an iterator over a stream of numbers, booleans and dates', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/test/numbers': {
          get: {
            ...{ 'x-streaming': true },
            operationId: 'getNumbers',
            responses: {
              '200': {
                description: 'getNumbers',
                content: {
                  'application/json': {
                    schema: {
                      type: 'number',
                    },
                  },
                },
              },
            },
          },
        },
        '/test/booleans': {
          get: {
            ...{ 'x-streaming': true },
            operationId: 'getBooleans',
            responses: {
              '200': {
                description: 'getBooleans',
                content: {
                  'text/plain': {
                    schema: {
                      type: 'boolean',
                    },
                  },
                },
              },
            },
          },
        },
        '/test/dates': {
          get: {
            ...{ 'x-streaming': true },
            operationId: 'getDates',
            responses: {
              '200': {
                description: 'getDates',
                content: {
                  'text/plain': {
                    schema: {
                      type: 'string',
                      format: 'date-time',
                    },
                  },
                },
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

    const types = tree.read('src/generated/types.gen.ts', 'utf-8');
    expect(types).toMatchSnapshot();

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    expect(client).toMatchSnapshot();

    // Test number stream
    const mockFetchNumbers = mockStreamingFetch(200, ['42', '-123.45']);
    const receivedNumbers: number[] = [];
    for await (const chunk of await callGeneratedClientStreaming(
      client,
      mockFetchNumbers,
      'getNumbers',
    )) {
      receivedNumbers.push(chunk);
    }
    expect(receivedNumbers).toEqual([42, -123.45]);

    // Test boolean stream
    const mockFetchBooleans = mockStreamingFetch(200, ['true', 'false']);
    const receivedBooleans: boolean[] = [];
    for await (const chunk of await callGeneratedClientStreaming(
      client,
      mockFetchBooleans,
      'getBooleans',
    )) {
      receivedBooleans.push(chunk);
    }
    expect(receivedBooleans).toEqual([true, false]);

    // Test date stream
    const mockFetchDates = mockStreamingFetch(200, [
      '2024-02-25T00:00:00.000Z',
      '2025-12-31T23:59:59.999Z',
    ]);
    const receivedDates: Date[] = [];
    for await (const chunk of await callGeneratedClientStreaming(
      client,
      mockFetchDates,
      'getDates',
    )) {
      receivedDates.push(chunk);
    }
    expect(receivedDates).toEqual([
      new Date('2024-02-25T00:00:00.000Z'),
      new Date('2025-12-31T23:59:59.999Z'),
    ]);
  });

  it('should return an iterator over a stream of arrays', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/test/number-arrays': {
          get: {
            ...{ 'x-streaming': true },
            operationId: 'getNumberArrays',
            responses: {
              '200': {
                description: 'getNumberArrays',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: {
                        type: 'number',
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/test/string-arrays': {
          get: {
            ...{ 'x-streaming': true },
            operationId: 'getStringArrays',
            responses: {
              '200': {
                description: 'getStringArrays',
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
              },
            },
          },
        },
        '/test/boolean-arrays': {
          get: {
            ...{ 'x-streaming': true },
            operationId: 'getBooleanArrays',
            responses: {
              '200': {
                description: 'getBooleanArrays',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: {
                        type: 'boolean',
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/test/date-arrays': {
          get: {
            ...{ 'x-streaming': true },
            operationId: 'getDateArrays',
            responses: {
              '200': {
                description: 'getDateArrays',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: {
                        type: 'string',
                        format: 'date-time',
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/test/object-arrays': {
          get: {
            ...{ 'x-streaming': true },
            operationId: 'getObjectArrays',
            responses: {
              '200': {
                description: 'getObjectArrays',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: {
                            type: 'number',
                          },
                          name: {
                            type: 'string',
                          },
                        },
                        required: ['id', 'name'],
                      },
                    },
                  },
                },
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

    const types = tree.read('src/generated/types.gen.ts', 'utf-8');
    expect(types).toMatchSnapshot();

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    expect(client).toMatchSnapshot();

    // Test number arrays
    const mockFetchNumberArrays = mockStreamingFetch(200, [
      '[1, 2, 3]',
      '[-4.5, 0, 6.7]',
    ]);
    const receivedNumberArrays: number[][] = [];
    for await (const chunk of await callGeneratedClientStreaming(
      client,
      mockFetchNumberArrays,
      'getNumberArrays',
    )) {
      receivedNumberArrays.push(chunk);
    }
    expect(receivedNumberArrays).toEqual([
      [1, 2, 3],
      [-4.5, 0, 6.7],
    ]);

    // Test string arrays
    const mockFetchStringArrays = mockStreamingFetch(200, [
      '["a", "b", "c"]',
      '["x", "y", "z"]',
    ]);
    const receivedStringArrays: string[][] = [];
    for await (const chunk of await callGeneratedClientStreaming(
      client,
      mockFetchStringArrays,
      'getStringArrays',
    )) {
      receivedStringArrays.push(chunk);
    }
    expect(receivedStringArrays).toEqual([
      ['a', 'b', 'c'],
      ['x', 'y', 'z'],
    ]);

    // Test boolean arrays
    const mockFetchBooleanArrays = mockStreamingFetch(200, [
      '[true, false, true]',
      '[false, false, true]',
    ]);
    const receivedBooleanArrays: boolean[][] = [];
    for await (const chunk of await callGeneratedClientStreaming(
      client,
      mockFetchBooleanArrays,
      'getBooleanArrays',
    )) {
      receivedBooleanArrays.push(chunk);
    }
    expect(receivedBooleanArrays).toEqual([
      [true, false, true],
      [false, false, true],
    ]);

    // Test date arrays
    const mockFetchDateArrays = mockStreamingFetch(200, [
      '["2024-02-25T00:00:00.000Z", "2024-02-26T00:00:00.000Z"]',
      '["2025-12-31T23:59:59.999Z", "2026-01-01T00:00:00.000Z"]',
    ]);
    const receivedDateArrays: Date[][] = [];
    for await (const chunk of await callGeneratedClientStreaming(
      client,
      mockFetchDateArrays,
      'getDateArrays',
    )) {
      receivedDateArrays.push(chunk);
    }
    expect(receivedDateArrays).toEqual([
      [
        new Date('2024-02-25T00:00:00.000Z'),
        new Date('2024-02-26T00:00:00.000Z'),
      ],
      [
        new Date('2025-12-31T23:59:59.999Z'),
        new Date('2026-01-01T00:00:00.000Z'),
      ],
    ]);

    // Test object arrays
    const mockFetchObjectArrays = mockStreamingFetch(200, [
      '[{"id": 1, "name": "first"}, {"id": 2, "name": "second"}]',
      '[{"id": 3, "name": "third"}, {"id": 4, "name": "fourth"}]',
    ]);
    const receivedObjectArrays: Array<{ id: number; name: string }>[] = [];
    for await (const chunk of await callGeneratedClientStreaming(
      client,
      mockFetchObjectArrays,
      'getObjectArrays',
    )) {
      receivedObjectArrays.push(chunk);
    }
    expect(receivedObjectArrays).toEqual([
      [
        { id: 1, name: 'first' },
        { id: 2, name: 'second' },
      ],
      [
        { id: 3, name: 'third' },
        { id: 4, name: 'fourth' },
      ],
    ]);
  });

  it('should return an iterator over a stream of dictionaries', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/test/number-dict': {
          get: {
            ...{ 'x-streaming': true },
            operationId: 'getNumberDict',
            responses: {
              '200': {
                description: 'getNumberDict',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      additionalProperties: {
                        type: 'number',
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/test/string-dict': {
          get: {
            ...{ 'x-streaming': true },
            operationId: 'getStringDict',
            responses: {
              '200': {
                description: 'getStringDict',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      additionalProperties: {
                        type: 'string',
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/test/enum-dict': {
          get: {
            ...{ 'x-streaming': true },
            operationId: 'getEnumDict',
            responses: {
              '200': {
                description: 'getEnumDict',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      additionalProperties: {
                        type: 'string',
                        enum: ['RED', 'GREEN', 'BLUE'],
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/test/boolean-dict': {
          get: {
            ...{ 'x-streaming': true },
            operationId: 'getBooleanDict',
            responses: {
              '200': {
                description: 'getBooleanDict',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      additionalProperties: {
                        type: 'boolean',
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/test/date-dict': {
          get: {
            ...{ 'x-streaming': true },
            operationId: 'getDateDict',
            responses: {
              '200': {
                description: 'getDateDict',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      additionalProperties: {
                        type: 'string',
                        format: 'date-time',
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/test/array-dict': {
          get: {
            ...{ 'x-streaming': true },
            operationId: 'getArrayDict',
            responses: {
              '200': {
                description: 'getArrayDict',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      additionalProperties: {
                        type: 'array',
                        items: {
                          type: 'number',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/test/object-array-dict': {
          get: {
            ...{ 'x-streaming': true },
            operationId: 'getObjectArrayDict',
            responses: {
              '200': {
                description: 'getObjectArrayDict',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      additionalProperties: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'number' },
                            name: { type: 'string' },
                          },
                          required: ['id', 'name'],
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/test/nested-dict': {
          get: {
            ...{ 'x-streaming': true },
            operationId: 'getNestedDict',
            responses: {
              '200': {
                description: 'getNestedDict',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      additionalProperties: {
                        type: 'object',
                        additionalProperties: {
                          type: 'object',
                          properties: {
                            value: { type: 'number' },
                            tags: {
                              type: 'array',
                              items: { type: 'string' },
                            },
                          },
                          required: ['value', 'tags'],
                        },
                      },
                    },
                  },
                },
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

    const types = tree.read('src/generated/types.gen.ts', 'utf-8');
    expect(types).toMatchSnapshot();

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    expect(client).toMatchSnapshot();

    // Test number dictionary
    const mockFetchNumberDict = mockStreamingFetch(200, [
      '{"a": 1, "b": 2}',
      '{"x": -3.14, "y": 0}',
    ]);
    const receivedNumberDicts: Record<string, number>[] = [];
    for await (const chunk of await callGeneratedClientStreaming(
      client,
      mockFetchNumberDict,
      'getNumberDict',
    )) {
      receivedNumberDicts.push(chunk);
    }
    expect(receivedNumberDicts).toEqual([
      { a: 1, b: 2 },
      { x: -3.14, y: 0 },
    ]);

    // Test string dictionary
    const mockFetchStringDict = mockStreamingFetch(200, [
      '{"first": "hello", "second": "world"}',
      '{"third": "test", "fourth": "data"}',
    ]);
    const receivedStringDicts: Record<string, string>[] = [];
    for await (const chunk of await callGeneratedClientStreaming(
      client,
      mockFetchStringDict,
      'getStringDict',
    )) {
      receivedStringDicts.push(chunk);
    }
    expect(receivedStringDicts).toEqual([
      { first: 'hello', second: 'world' },
      { third: 'test', fourth: 'data' },
    ]);

    // Test enum dictionary
    const mockFetchEnumDict = mockStreamingFetch(200, [
      '{"primary": "RED", "secondary": "BLUE"}',
      '{"accent": "GREEN"}',
    ]);
    const receivedEnumDicts: Record<string, 'RED' | 'GREEN' | 'BLUE'>[] = [];
    for await (const chunk of await callGeneratedClientStreaming(
      client,
      mockFetchEnumDict,
      'getEnumDict',
    )) {
      receivedEnumDicts.push(chunk);
    }
    expect(receivedEnumDicts).toEqual([
      { primary: 'RED', secondary: 'BLUE' },
      { accent: 'GREEN' },
    ]);

    // Test boolean dictionary
    const mockFetchBooleanDict = mockStreamingFetch(200, [
      '{"isValid": true, "isEnabled": false}',
      '{"isReady": true}',
    ]);
    const receivedBooleanDicts: Record<string, boolean>[] = [];
    for await (const chunk of await callGeneratedClientStreaming(
      client,
      mockFetchBooleanDict,
      'getBooleanDict',
    )) {
      receivedBooleanDicts.push(chunk);
    }
    expect(receivedBooleanDicts).toEqual([
      { isValid: true, isEnabled: false },
      { isReady: true },
    ]);

    // Test date dictionary
    const mockFetchDateDict = mockStreamingFetch(200, [
      '{"start": "2024-02-25T00:00:00.000Z", "end": "2024-02-26T00:00:00.000Z"}',
      '{"deadline": "2025-12-31T23:59:59.999Z"}',
    ]);
    const receivedDateDicts: Record<string, Date>[] = [];
    for await (const chunk of await callGeneratedClientStreaming(
      client,
      mockFetchDateDict,
      'getDateDict',
    )) {
      receivedDateDicts.push(chunk);
    }
    expect(receivedDateDicts).toEqual([
      {
        start: new Date('2024-02-25T00:00:00.000Z'),
        end: new Date('2024-02-26T00:00:00.000Z'),
      },
      {
        deadline: new Date('2025-12-31T23:59:59.999Z'),
      },
    ]);

    // Test array dictionary
    const mockFetchArrayDict = mockStreamingFetch(200, [
      '{"scores": [1, 2, 3], "values": [-1, 0, 1]}',
      '{"grades": [85, 90, 95]}',
    ]);
    const receivedArrayDicts: Record<string, number[]>[] = [];
    for await (const chunk of await callGeneratedClientStreaming(
      client,
      mockFetchArrayDict,
      'getArrayDict',
    )) {
      receivedArrayDicts.push(chunk);
    }
    expect(receivedArrayDicts).toEqual([
      { scores: [1, 2, 3], values: [-1, 0, 1] },
      { grades: [85, 90, 95] },
    ]);

    // Test object array dictionary
    const mockFetchObjectArrayDict = mockStreamingFetch(200, [
      '{"users": [{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}]}',
      '{"admins": [{"id": 3, "name": "Charlie"}]}',
    ]);
    const receivedObjectArrayDicts: Record<
      string,
      Array<{ id: number; name: string }>
    >[] = [];
    for await (const chunk of await callGeneratedClientStreaming(
      client,
      mockFetchObjectArrayDict,
      'getObjectArrayDict',
    )) {
      receivedObjectArrayDicts.push(chunk);
    }
    expect(receivedObjectArrayDicts).toEqual([
      {
        users: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
      },
      { admins: [{ id: 3, name: 'Charlie' }] },
    ]);

    // Test nested dictionary
    const mockFetchNestedDict = mockStreamingFetch(200, [
      '{"region1": {"zone1": {"value": 42, "tags": ["prod", "high"]}}}',
      '{"region2": {"zone2": {"value": 21, "tags": ["dev"]}}}',
    ]);
    const receivedNestedDicts: Record<
      string,
      Record<string, { value: number; tags: string[] }>
    >[] = [];
    for await (const chunk of await callGeneratedClientStreaming(
      client,
      mockFetchNestedDict,
      'getNestedDict',
    )) {
      receivedNestedDicts.push(chunk);
    }
    expect(receivedNestedDicts).toEqual([
      {
        region1: {
          zone1: { value: 42, tags: ['prod', 'high'] },
        },
      },
      {
        region2: {
          zone2: { value: 21, tags: ['dev'] },
        },
      },
    ]);
  });

  it('should handle error responses for streaming operations', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/stream': {
          get: {
            ...{ 'x-streaming': true },
            operationId: 'getStream',
            responses: {
              '200': {
                description: 'Success',
                content: {
                  'application/json': {
                    schema: {
                      type: 'number',
                    },
                  },
                },
              },
              '400': {
                description: 'Bad Request',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        code: { type: 'string' },
                        message: { type: 'string' },
                      },
                      required: ['code', 'message'],
                    },
                  },
                },
              },
              '500': {
                description: 'Internal Server Error',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        error: { type: 'string' },
                        details: { type: 'string' },
                      },
                      required: ['error'],
                    },
                  },
                },
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

    const types = tree.read('src/generated/types.gen.ts', 'utf-8');
    expect(types).toMatchSnapshot();

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    expect(client).toMatchSnapshot();

    // Test 400 error
    const mockFetch400 = vi.fn();
    mockFetch400.mockResolvedValue({
      status: 400,
      json: vi.fn().mockResolvedValue({
        code: 'INVALID_PARAMETER',
        message: 'Invalid query parameter',
      }),
    });

    await expect(async () => {
      for await (const chunk of await callGeneratedClientStreaming(
        client,
        mockFetch400,
        'getStream',
      )) {
        // noop
      }
    }).rejects.toThrow(
      expect.objectContaining({
        status: 400,
        error: {
          code: 'INVALID_PARAMETER',
          message: 'Invalid query parameter',
        },
      }),
    );

    // Test 500 error
    const mockFetch500 = vi.fn();
    mockFetch500.mockResolvedValue({
      status: 500,
      json: vi.fn().mockResolvedValue({
        error: 'Internal error occurred',
        details: 'Stack trace...',
      }),
    });

    await expect(async () => {
      for await (const chunk of await callGeneratedClientStreaming(
        client,
        mockFetch500,
        'getStream',
      )) {
        // noop
      }
    }).rejects.toThrow(
      expect.objectContaining({
        status: 500,
        error: {
          error: 'Internal error occurred',
          details: 'Stack trace...',
        },
      }),
    );
  });
});
