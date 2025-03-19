/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { openApiTsClientGenerator } from './generator';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { Spec } from '../utils/types';
import {
  baseUrl,
  callGeneratedClient,
  expectTypeScriptToCompile,
} from './generator.utils.spec';
import { Tree } from '@nx/devkit';

describe('openApiTsClientGenerator - complex types', () => {
  let tree: Tree;
  const title = 'TestApi';

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const validateTypeScript = (paths: string[]) => {
    expectTypeScriptToCompile(tree, paths);
  };

  it('should handle response objects with a mixture of properties and additionalProperties', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/dynamic-properties-any': {
          get: {
            operationId: 'getDynamicPropertiesAny',
            responses: {
              '200': {
                description: 'A response with dynamic properties of any type',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      additionalProperties: true,
                      properties: {
                        id: { type: 'string' },
                        timestamp: { type: 'string', format: 'date-time' },
                      },
                      required: ['id'],
                    },
                  },
                },
              },
            },
          },
        },
        '/dynamic-properties-numbers': {
          get: {
            operationId: 'getDynamicPropertiesNumbers',
            responses: {
              '200': {
                description:
                  'A response with dynamic properties that must be numbers',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                      },
                      additionalProperties: { type: 'number' },
                      required: ['id', 'name'],
                    },
                  },
                },
              },
            },
          },
        },
        '/dynamic-properties-objects': {
          get: {
            operationId: 'getDynamicPropertiesObjects',
            responses: {
              '200': {
                description:
                  'A response with dynamic properties that are objects with properties',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        last_modified_timestamp: {
                          type: 'string',
                          format: 'date-time',
                        },
                      },
                      additionalProperties: {
                        type: 'object',
                        properties: {
                          title: { type: 'string' },
                          value: { type: 'number' },
                          active: { type: 'boolean' },
                        },
                        required: ['title', 'value'],
                      },
                      required: ['id', 'name'],
                    },
                  },
                },
              },
            },
          },
        },
        '/dynamic-properties-nested': {
          get: {
            operationId: 'getDynamicPropertiesNested',
            responses: {
              '200': {
                description:
                  'A response with dynamic properties that have nested dynamic properties',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        version: { type: 'string' },
                      },
                      additionalProperties: {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                          config: {
                            type: 'object',
                            additionalProperties: { type: 'number' },
                          },
                        },
                        required: ['name'],
                      },
                      required: ['id'],
                    },
                  },
                },
              },
            },
          },
        },
        '/dynamic-property-values': {
          get: {
            operationId: 'getDynamicPropertyValues',
            responses: {
              '200': {
                description: 'A response with a dictionary of values',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      additionalProperties: {
                        type: 'object',
                        properties: {
                          value: { type: 'string' },
                          metadata: {
                            type: 'object',
                            additionalProperties: true,
                          },
                        },
                        required: ['value'],
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

    // Test dynamic properties with any type
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        id: 'test123',
        timestamp: '2023-01-01T12:00:00Z',
        dynamicProp1: 'value1',
        dynamicProp2: 42,
        dynamicProp3: { nestedValue: true },
      }),
    });

    const responseAny = await callGeneratedClient(
      client,
      mockFetch,
      'getDynamicPropertiesAny',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/dynamic-properties-any`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(responseAny).toEqual({
      id: 'test123',
      timestamp: new Date('2023-01-01T12:00:00Z'),
      dynamicProp1: 'value1',
      dynamicProp2: 42,
      dynamicProp3: { nestedValue: true },
    });

    // Test dynamic properties with number type constraints
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        id: 'test456',
        name: 'Test Item',
        count: 42,
        price: 99.99,
        rating: 4.5,
      }),
    });

    const responseNumbers = await callGeneratedClient(
      client,
      mockFetch,
      'getDynamicPropertiesNumbers',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/dynamic-properties-numbers`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(responseNumbers).toEqual({
      id: 'test456',
      name: 'Test Item',
      count: 42,
      price: 99.99,
      rating: 4.5,
    });

    // Test dynamic properties with object type constraints
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        id: 'test789',
        name: 'Complex Item',
        last_modified_timestamp: '2025-01-01T00:00:00.000Z',
        feature1: {
          title: 'First Feature',
          value: 100,
          active: true,
        },
        feature2: {
          title: 'Second Feature',
          value: 200,
          active: false,
        },
        feature3: {
          title: 'Third Feature',
          value: 300,
        },
      }),
    });

    const responseObjects = await callGeneratedClient(
      client,
      mockFetch,
      'getDynamicPropertiesObjects',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/dynamic-properties-objects`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(responseObjects).toEqual({
      id: 'test789',
      name: 'Complex Item',
      lastModifiedTimestamp: new Date('2025-01-01T00:00:00.000Z'),
      feature1: {
        title: 'First Feature',
        value: 100,
        active: true,
      },
      feature2: {
        title: 'Second Feature',
        value: 200,
        active: false,
      },
      feature3: {
        title: 'Third Feature',
        value: 300,
      },
    });

    // Test dynamic properties with nested dynamic properties
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        id: 'nested123',
        version: '1.0.0',
        module1: {
          name: 'First Module',
          config: {
            timeout: 5000,
            retries: 3,
            maxConnections: 10,
          },
        },
        module2: {
          name: 'Second Module',
          config: {
            timeout: 3000,
            maxSize: 1024,
          },
        },
      }),
    });

    const responseNested = await callGeneratedClient(
      client,
      mockFetch,
      'getDynamicPropertiesNested',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/dynamic-properties-nested`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(responseNested).toEqual({
      id: 'nested123',
      version: '1.0.0',
      module1: {
        name: 'First Module',
        config: {
          timeout: 5000,
          retries: 3,
          maxConnections: 10,
        },
      },
      module2: {
        name: 'Second Module',
        config: {
          timeout: 3000,
          maxSize: 1024,
        },
      },
    });

    // Test nested dynamic properties response
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        prop1: {
          value: 'value1',
          metadata: { source: 'system', priority: 'high' },
        },
        prop2: {
          value: 'value2',
          metadata: { source: 'user', tags: ['important', 'verified'] },
        },
      }),
    });

    const nestedResponse = await callGeneratedClient(
      client,
      mockFetch,
      'getDynamicPropertyValues',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/dynamic-property-values`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(nestedResponse).toEqual({
      prop1: {
        value: 'value1',
        metadata: { source: 'system', priority: 'high' },
      },
      prop2: {
        value: 'value2',
        metadata: { source: 'user', tags: ['important', 'verified'] },
      },
    });
  });

  it('should handle response objects with patternProperties', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/pattern-properties-single': {
          get: {
            operationId: 'getPatternPropertiesSingle',
            responses: {
              '200': {
                description: 'A response with a single pattern property',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                      },
                      ...{
                        patternProperties: {
                          '^x-': { type: 'string' },
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
        '/pattern-properties-multiple': {
          get: {
            operationId: 'getPatternPropertiesMultiple',
            responses: {
              '200': {
                description: 'A response with multiple pattern properties',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                      },
                      ...{
                        patternProperties: {
                          '^x-': { type: 'string' },
                          '^y-': { type: 'number' },
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
        '/pattern-properties-mixed': {
          get: {
            operationId: 'getPatternPropertiesMixed',
            responses: {
              '200': {
                description:
                  'A response with a mixture of patternProperties, properties, and additionalProperties',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                      },
                      ...{
                        patternProperties: {
                          '^x-': { type: 'string' },
                        },
                      },
                      additionalProperties: { type: 'number' },
                      required: ['id', 'name'],
                    },
                  },
                },
              },
            },
          },
        },
        '/pattern-properties-no-props': {
          get: {
            operationId: 'getPatternPropertiesNoProps',
            responses: {
              '200': {
                description:
                  'A response with patternProperties and additionalProperties but no properties',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      ...{
                        patternProperties: {
                          '^x-': { type: 'string' },
                        },
                      },
                      additionalProperties: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
        },
        '/pattern-properties-only': {
          get: {
            operationId: 'getPatternPropertiesOnly',
            responses: {
              '200': {
                description: 'A response with only patternProperties',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      ...{
                        patternProperties: {
                          '^x-': { type: 'string' },
                          '^y-': { type: 'number' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/pattern-properties-nested': {
          get: {
            operationId: 'getPatternPropertiesNested',
            responses: {
              '200': {
                description: 'A response with nested patternProperties',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        config: {
                          type: 'object',
                          ...{
                            patternProperties: {
                              '^setting-': {
                                type: 'object',
                                properties: {
                                  is_enabled: { type: 'boolean' },
                                },
                                patternProperties: {
                                  '^option-': { type: 'string' },
                                },
                              },
                            },
                          },
                        },
                      },
                      required: ['id'],
                    },
                  },
                },
              },
            },
          },
        },
        '/pattern-properties-array-objects': {
          get: {
            operationId: 'getPatternPropertiesArrayObjects',
            responses: {
              '200': {
                description:
                  'A response with properties, patternProperties and additionalProperties that are all arrays of objects',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        items: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              name: { type: 'string' },
                              value: { type: 'number' },
                            },
                          },
                        },
                      },
                      ...{
                        patternProperties: {
                          '^x-': {
                            type: 'array',
                            items: {
                              type: 'object',
                              properties: {
                                label: { type: 'string' },
                                enabled: { type: 'boolean' },
                              },
                            },
                          },
                        },
                      },
                      additionalProperties: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            count: { type: 'number' },
                          },
                        },
                      },
                      required: ['id'],
                    },
                  },
                },
              },
            },
          },
        },
        '/pattern-properties-array-primitives': {
          get: {
            operationId: 'getPatternPropertiesArrayPrimitives',
            responses: {
              '200': {
                description:
                  'A response with properties, patternProperties and additionalProperties that are all arrays of primitives',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        stringArray: {
                          type: 'array',
                          items: { type: 'string' },
                        },
                        numberArray: {
                          type: 'array',
                          items: { type: 'number' },
                        },
                      },
                      ...{
                        patternProperties: {
                          '^x-': {
                            type: 'array',
                            items: { type: 'string' },
                          },
                          '^y-': {
                            type: 'array',
                            items: { type: 'number' },
                          },
                        },
                      },
                      additionalProperties: {
                        type: 'array',
                        items: { type: 'boolean' },
                      },
                      required: ['id'],
                    },
                  },
                },
              },
            },
          },
        },
        '/pattern-properties-array-arrays': {
          get: {
            operationId: 'getPatternPropertiesArrayArrays',
            responses: {
              '200': {
                description:
                  'A response with properties, patternProperties and additionalProperties that are all arrays of arrays of primitives',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        matrix: {
                          type: 'array',
                          items: {
                            type: 'array',
                            items: { type: 'number' },
                          },
                        },
                      },
                      ...{
                        patternProperties: {
                          '^x-': {
                            type: 'array',
                            items: {
                              type: 'array',
                              items: { type: 'string' },
                            },
                          },
                        },
                      },
                      additionalProperties: {
                        type: 'array',
                        items: {
                          type: 'array',
                          items: { type: 'boolean' },
                        },
                      },
                      required: ['id'],
                    },
                  },
                },
              },
            },
          },
        },
        '/pattern-properties-array-string-dicts': {
          get: {
            operationId: 'getPatternPropertiesArrayStringDicts',
            responses: {
              '200': {
                description:
                  'A response with properties, patternProperties and additionalProperties that are all arrays of string dictionaries',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        dictionaries: {
                          type: 'array',
                          items: {
                            type: 'object',
                            additionalProperties: { type: 'string' },
                          },
                        },
                      },
                      ...{
                        patternProperties: {
                          '^x-': {
                            type: 'array',
                            items: {
                              type: 'object',
                              additionalProperties: { type: 'string' },
                            },
                          },
                        },
                      },
                      additionalProperties: {
                        type: 'array',
                        items: {
                          type: 'object',
                          additionalProperties: { type: 'string' },
                        },
                      },
                      required: ['id'],
                    },
                  },
                },
              },
            },
          },
        },
        '/pattern-properties-array-object-dicts': {
          get: {
            operationId: 'getPatternPropertiesArrayObjectDicts',
            responses: {
              '200': {
                description:
                  'A response with properties, patternProperties and additionalProperties that are all arrays of object dictionaries',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        objectDicts: {
                          type: 'array',
                          items: {
                            type: 'object',
                            additionalProperties: {
                              type: 'object',
                              properties: {
                                name: { type: 'string' },
                                value: { type: 'number' },
                              },
                            },
                          },
                        },
                      },
                      ...{
                        patternProperties: {
                          '^x-': {
                            type: 'array',
                            items: {
                              type: 'object',
                              additionalProperties: {
                                type: 'object',
                                properties: {
                                  label: { type: 'string' },
                                  enabled: { type: 'boolean' },
                                },
                              },
                            },
                          },
                        },
                      },
                      additionalProperties: {
                        type: 'array',
                        items: {
                          type: 'object',
                          additionalProperties: {
                            type: 'object',
                            properties: {
                              id: { type: 'string' },
                              count: { type: 'number' },
                            },
                          },
                        },
                      },
                      required: ['id'],
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

    // Test single pattern property
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        id: 'test123',
        name: 'Test Item',
        'x-custom': 'custom value',
        'x-another': 'another value',
      }),
    });

    const responseSingle = await callGeneratedClient(
      client,
      mockFetch,
      'getPatternPropertiesSingle',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/pattern-properties-single`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(responseSingle).toEqual({
      id: 'test123',
      name: 'Test Item',
      'x-custom': 'custom value',
      'x-another': 'another value',
    });

    // Test multiple pattern properties
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        id: 'test456',
        name: 'Test Item 2',
        'x-custom': 'custom value',
        'y-count': 42,
        'y-price': 99.99,
      }),
    });

    const responseMultiple = await callGeneratedClient(
      client,
      mockFetch,
      'getPatternPropertiesMultiple',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/pattern-properties-multiple`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(responseMultiple).toEqual({
      id: 'test456',
      name: 'Test Item 2',
      'x-custom': 'custom value',
      'y-count': 42,
      'y-price': 99.99,
    });

    // Test mixed properties, patternProperties, and additionalProperties
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        id: 'test789',
        name: 'Test Item 3',
        'x-custom': 'custom value',
        'other-prop': 123,
        'another-prop': 456,
      }),
    });

    const responseMixed = await callGeneratedClient(
      client,
      mockFetch,
      'getPatternPropertiesMixed',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/pattern-properties-mixed`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(responseMixed).toEqual({
      id: 'test789',
      name: 'Test Item 3',
      'x-custom': 'custom value',
      'other-prop': 123,
      'another-prop': 456,
    });

    // Test patternProperties and additionalProperties but no properties
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        'x-custom': 'custom value',
        'x-another': 'another value',
        'other-prop': 123,
        'another-prop': 456,
      }),
    });

    const responseNoProps = await callGeneratedClient(
      client,
      mockFetch,
      'getPatternPropertiesNoProps',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/pattern-properties-no-props`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(responseNoProps).toEqual({
      'x-custom': 'custom value',
      'x-another': 'another value',
      'other-prop': 123,
      'another-prop': 456,
    });

    // Test only patternProperties
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        'x-custom': 'custom value',
        'y-count': 42,
        'y-price': 99.99,
      }),
    });

    const responseOnlyPatterns = await callGeneratedClient(
      client,
      mockFetch,
      'getPatternPropertiesOnly',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/pattern-properties-only`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(responseOnlyPatterns).toEqual({
      'x-custom': 'custom value',
      'y-count': 42,
      'y-price': 99.99,
    });

    // Test nested patternProperties
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        id: 'test789',
        config: {
          'setting-theme': {
            is_enabled: true,
            'option-color': 'blue',
            'option-size': 'large',
          },
          'setting-notifications': {
            is_enabled: false,
            'option-sound': 'chime',
          },
        },
      }),
    });

    const responseNested = await callGeneratedClient(
      client,
      mockFetch,
      'getPatternPropertiesNested',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/pattern-properties-nested`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(responseNested).toEqual({
      id: 'test789',
      config: {
        'setting-theme': {
          isEnabled: true,
          'option-color': 'blue',
          'option-size': 'large',
        },
        'setting-notifications': {
          isEnabled: false,
          'option-sound': 'chime',
        },
      },
    });

    // Test arrays of objects with pattern properties
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        id: 'array-objects',
        items: [
          { name: 'Item 1', value: 100 },
          { name: 'Item 2', value: 200 },
        ],
        'x-metadata': [
          { label: 'Meta 1', enabled: true },
          { label: 'Meta 2', enabled: false },
        ],
        'custom-items': [
          { id: 'c1', count: 5 },
          { id: 'c2', count: 10 },
        ],
      }),
    });

    const responseArrayObjects = await callGeneratedClient(
      client,
      mockFetch,
      'getPatternPropertiesArrayObjects',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/pattern-properties-array-objects`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(responseArrayObjects).toEqual({
      id: 'array-objects',
      items: [
        { name: 'Item 1', value: 100 },
        { name: 'Item 2', value: 200 },
      ],
      'x-metadata': [
        { label: 'Meta 1', enabled: true },
        { label: 'Meta 2', enabled: false },
      ],
      'custom-items': [
        { id: 'c1', count: 5 },
        { id: 'c2', count: 10 },
      ],
    });

    // Test arrays of primitives with pattern properties
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        id: 'array-primitives',
        stringArray: ['a', 'b', 'c'],
        numberArray: [1, 2, 3],
        'x-tags': ['tag1', 'tag2'],
        'y-values': [10, 20, 30],
        'custom-flags': [true, false, true],
      }),
    });

    const responseArrayPrimitives = await callGeneratedClient(
      client,
      mockFetch,
      'getPatternPropertiesArrayPrimitives',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/pattern-properties-array-primitives`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(responseArrayPrimitives).toEqual({
      id: 'array-primitives',
      stringArray: ['a', 'b', 'c'],
      numberArray: [1, 2, 3],
      'x-tags': ['tag1', 'tag2'],
      'y-values': [10, 20, 30],
      'custom-flags': [true, false, true],
    });

    // Test arrays of arrays with pattern properties
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        id: 'array-arrays',
        matrix: [
          [1, 2],
          [3, 4],
        ],
        'x-grid': [
          ['a', 'b'],
          ['c', 'd'],
        ],
        'custom-matrix': [
          [true, false],
          [false, true],
        ],
      }),
    });

    const responseArrayArrays = await callGeneratedClient(
      client,
      mockFetch,
      'getPatternPropertiesArrayArrays',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/pattern-properties-array-arrays`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(responseArrayArrays).toEqual({
      id: 'array-arrays',
      matrix: [
        [1, 2],
        [3, 4],
      ],
      'x-grid': [
        ['a', 'b'],
        ['c', 'd'],
      ],
      'custom-matrix': [
        [true, false],
        [false, true],
      ],
    });

    // Test arrays of string dictionaries with pattern properties
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        id: 'array-string-dicts',
        dictionaries: [
          { key1: 'value1', key2: 'value2' },
          { key3: 'value3', key4: 'value4' },
        ],
        'x-metadata': [
          { tag1: 'meta1', tag2: 'meta2' },
          { tag3: 'meta3', tag4: 'meta4' },
        ],
        'custom-dicts': [
          { prop1: 'val1', prop2: 'val2' },
          { prop3: 'val3', prop4: 'val4' },
        ],
      }),
    });

    const responseArrayStringDicts = await callGeneratedClient(
      client,
      mockFetch,
      'getPatternPropertiesArrayStringDicts',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/pattern-properties-array-string-dicts`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(responseArrayStringDicts).toEqual({
      id: 'array-string-dicts',
      dictionaries: [
        { key1: 'value1', key2: 'value2' },
        { key3: 'value3', key4: 'value4' },
      ],
      'x-metadata': [
        { tag1: 'meta1', tag2: 'meta2' },
        { tag3: 'meta3', tag4: 'meta4' },
      ],
      'custom-dicts': [
        { prop1: 'val1', prop2: 'val2' },
        { prop3: 'val3', prop4: 'val4' },
      ],
    });

    // Test arrays of object dictionaries with pattern properties
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        id: 'array-object-dicts',
        objectDicts: [
          {
            obj1: { name: 'Object 1', value: 100 },
            obj2: { name: 'Object 2', value: 200 },
          },
          {
            obj3: { name: 'Object 3', value: 300 },
            obj4: { name: 'Object 4', value: 400 },
          },
        ],
        'x-metadata': [
          {
            meta1: { label: 'Meta 1', enabled: true },
            meta2: { label: 'Meta 2', enabled: false },
          },
        ],
        'custom-dicts': [
          {
            item1: { id: 'i1', count: 5 },
            item2: { id: 'i2', count: 10 },
          },
        ],
      }),
    });

    const responseArrayObjectDicts = await callGeneratedClient(
      client,
      mockFetch,
      'getPatternPropertiesArrayObjectDicts',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/pattern-properties-array-object-dicts`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(responseArrayObjectDicts).toEqual({
      id: 'array-object-dicts',
      objectDicts: [
        {
          obj1: { name: 'Object 1', value: 100 },
          obj2: { name: 'Object 2', value: 200 },
        },
        {
          obj3: { name: 'Object 3', value: 300 },
          obj4: { name: 'Object 4', value: 400 },
        },
      ],
      'x-metadata': [
        {
          meta1: { label: 'Meta 1', enabled: true },
          meta2: { label: 'Meta 2', enabled: false },
        },
      ],
      'custom-dicts': [
        {
          item1: { id: 'i1', count: 5 },
          item2: { id: 'i2', count: 10 },
        },
      ],
    });
  });
});