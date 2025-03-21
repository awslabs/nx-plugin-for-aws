/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { openApiTsClientGenerator } from './generator';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { Spec } from '../utils/types';
import { importTypeScriptModule } from '../../utils/js';
import {
  baseUrl,
  callGeneratedClient,
  expectTypeScriptToCompile,
} from './generator.utils.spec';
import { Tree } from '@nx/devkit';

describe('openApiTsClientGenerator - primitive types', () => {
  let tree: Tree;
  const title = 'TestApi';

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const validateTypeScript = (paths: string[]) => {
    expectTypeScriptToCompile(tree, paths);
  };

  it('should generate valid TypeScript for primitive types', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/test': {
          get: {
            operationId: 'getTest',
            description: 'Sends a test request!',
            responses: {
              '200': {
                description: 'getTest',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        string: { type: 'string' },
                        number: { type: 'number' },
                        integer: { type: 'integer' },
                        boolean: { type: 'boolean' },
                        'nullable-string': { type: 'string', nullable: true },
                        optionalNumber: { type: 'number' },
                      },
                      required: ['string', 'number', 'integer', 'boolean'],
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

    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        string: 'str',
        number: 42.3,
        integer: 33,
        boolean: true,
        'nullable-string': null,
      }),
    });
    const response = await callGeneratedClient(client, mockFetch, 'getTest');
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/test`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(response).toEqual({
      string: 'str',
      number: 42.3,
      integer: 33,
      boolean: true,
      nullableString: null,
    });
  });

  it('should handle number and string constraints', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/constraints': {
          post: {
            operationId: 'testConstraints',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      constrainedInt: {
                        type: 'integer',
                        minimum: 3,
                        maximum: 7,
                        exclusiveMinimum: true,
                        exclusiveMaximum: true,
                      },
                      constrainedString: {
                        type: 'string',
                        minLength: 4,
                        maxLength: 10,
                      },
                      hostname: {
                        type: 'string',
                        format: 'hostname',
                      },
                      ipv4: {
                        type: 'string',
                        format: 'ipv4',
                      },
                      ipv6: {
                        type: 'string',
                        format: 'ipv6',
                      },
                      uri: {
                        type: 'string',
                        format: 'uri',
                      },
                    },
                    required: ['constrainedInt', 'constrainedString'],
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'test',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        result: { type: 'string' },
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

    const mockFetch = vi.fn();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({ result: 'success' }),
    });

    const testData = {
      constrainedInt: 5,
      constrainedString: 'test1234',
      hostname: 'example.com',
      ipv4: '192.168.1.1',
      ipv6: '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
      uri: 'https://example.com',
    };

    expect(
      await callGeneratedClient(client, mockFetch, 'testConstraints', testData),
    ).toEqual({ result: 'success' });

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/constraints`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(testData),
      }),
    );
  });

  it('should handle special formats and vendor extensions', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/test': {
          post: {
            operationId: 'postTest',
            ...{
              'x-aws-api-integration': {
                type: 'aws_proxy',
              },
            },
            parameters: [
              {
                name: 'date',
                in: 'query',
                schema: { type: 'string', format: 'date' },
              },
              {
                name: 'timestamp',
                in: 'query',
                schema: { type: 'string', format: 'date-time' },
              },
            ],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      int32: { type: 'integer', format: 'int32' },
                      int64: { type: 'integer', format: 'int64' },
                      float: { type: 'number', format: 'float' },
                      double: { type: 'number', format: 'double' },
                      binary: { type: 'string', format: 'binary' },
                      byte: { type: 'string', format: 'byte' },
                      uuid: { type: 'string', format: 'uuid' },
                      email: { type: 'string', format: 'email' },
                    },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'test',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        createdAt: { type: 'string', format: 'date-time' },
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
  });

  it('should handle enum request and response bodies', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/status': {
          post: {
            operationId: 'updateStatus',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'string',
                    enum: ['pending', 'in_progress', 'completed', 'failed'],
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Updated status result',
                content: {
                  'application/json': {
                    schema: {
                      type: 'string',
                      enum: ['accepted', 'rejected'],
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

    const mockFetch = vi.fn();

    mockFetch.mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue('accepted'),
    });

    expect(
      await callGeneratedClient(client, mockFetch, 'updateStatus', 'pending'),
    ).toEqual('accepted');
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/status`,
      expect.objectContaining({
        method: 'POST',
        body: 'pending',
      }),
    );
  });

  it('should handle date and date-time formats', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/single-date': {
          post: {
            operationId: 'postSingleDate',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'string',
                    format: 'date',
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
                      type: 'string',
                      format: 'date',
                    },
                  },
                },
              },
            },
          },
        },
        '/dates': {
          post: {
            operationId: 'postDates',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      dateOnly: {
                        type: 'string',
                        format: 'date',
                      },
                      dateTime: {
                        type: 'string',
                        format: 'date-time',
                      },
                      dateArray: {
                        type: 'array',
                        items: {
                          type: 'string',
                          format: 'date',
                        },
                      },
                      dateTimeArray: {
                        type: 'array',
                        items: {
                          type: 'string',
                          format: 'date-time',
                        },
                      },
                    },
                    required: ['dateOnly', 'dateTime'],
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Success',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        processedDate: {
                          type: 'string',
                          format: 'date',
                        },
                        processedDateTime: {
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

    const mockFetch = vi.fn();

    // Test single date
    mockFetch.mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue('2023-01-01'),
    });
    expect(
      await callGeneratedClient(
        client,
        mockFetch,
        'postSingleDate',
        new Date('2023-12-25'),
      ),
    ).toEqual(new Date('2023-01-01'));
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/single-date`,
      expect.objectContaining({
        method: 'POST',
        body: '2023-12-25',
      }),
    );

    // Test complex date object
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        processedDate: '2023-01-01',
        processedDateTime: '2023-01-01T12:00:00Z',
      }),
    });

    const datePayload = {
      dateOnly: new Date('2023-12-25'),
      dateTime: new Date('2023-12-25T15:30:00Z'),
      dateArray: [new Date('2023-12-26'), new Date('2023-12-27')],
      dateTimeArray: [
        new Date('2023-12-26T10:00:00Z'),
        new Date('2023-12-27T11:00:00Z'),
      ],
    };

    expect(
      await callGeneratedClient(client, mockFetch, 'postDates', datePayload),
    ).toEqual({
      processedDate: new Date('2023-01-01'),
      processedDateTime: new Date('2023-01-01T12:00:00Z'),
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/dates`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          dateOnly: '2023-12-25',
          dateTime: '2023-12-25T15:30:00.000Z',
          dateArray: ['2023-12-26', '2023-12-27'],
          dateTimeArray: [
            '2023-12-26T10:00:00.000Z',
            '2023-12-27T11:00:00.000Z',
          ],
        }),
      }),
    );
  });

  it('should generate valid typescript for openapi v3.1 specifications with null types', async () => {
    const spec: Spec = {
      info: {
        title,
        version: '1.0.0',
      },
      openapi: '3.1.0',
      paths: {
        '/test': {
          post: {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      requiredNull: {
                        type: 'null',
                      },
                      optionalNull: {
                        type: 'null',
                      },
                      requiredCompositeNull: {
                        anyOf: [
                          {
                            type: 'string',
                          },
                          {
                            type: 'null',
                          },
                        ],
                      },
                      optionalCompositeNull: {
                        anyOf: [
                          {
                            type: 'string',
                          },
                          {
                            type: 'null',
                          },
                        ],
                      },
                    },
                    required: ['requiredNull', 'requiredCompositeNull'],
                  } as any,
                },
              },
            },
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {},
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

    const types = tree.read('src/generated/types.gen.ts', 'utf-8');
    expect(types).toMatchSnapshot();

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    expect(client).toMatchSnapshot();

    const mockFetch = vi.fn();

    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({}),
    });

    const { TestApi } = await importTypeScriptModule<any>(client);
    const c = new TestApi({
      url: baseUrl,
      fetch: mockFetch,
    });

    expect(
      await c.postTest({ requiredNull: null, requiredCompositeNull: 'string' }),
    ).toEqual({});
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/test`,
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });
});
