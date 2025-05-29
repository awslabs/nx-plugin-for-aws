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

describe('openApiTsClientGenerator - arrays', () => {
  let tree: Tree;
  const title = 'TestApi';

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const validateTypeScript = (paths: string[]) => {
    expectTypeScriptToCompile(tree, paths);
  };

  it('should handle operation which accepts an array of strings', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/process-tags': {
          post: {
            operationId: 'processTags',
            description: 'Process an array of string tags',
            requestBody: {
              required: true,
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
            responses: {
              '200': {
                description: 'Success',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        processed: { type: 'number' },
                        message: { type: 'string' },
                      },
                      required: ['processed', 'message'],
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
        processed: 3,
        message: 'Tags processed successfully',
      }),
    });

    const tags = ['tag1', 'tag2', 'tag3'];
    const response = await callGeneratedClient(
      client,
      mockFetch,
      'processTags',
      tags,
    );

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/process-tags`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(tags),
      }),
    );
    expect(response).toEqual({
      processed: 3,
      message: 'Tags processed successfully',
    });
  });

  it('should handle operation which accepts an array of objects', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/process-users': {
          post: {
            operationId: 'processUsers',
            description: 'Process an array of user objects',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        email: { type: 'string' },
                        age: { type: 'number' },
                        active: { type: 'boolean' },
                      },
                      required: ['id', 'name', 'email'],
                    },
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
                        processed: { type: 'number' },
                        status: { type: 'string' },
                      },
                      required: ['processed', 'status'],
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
        processed: 2,
        status: 'completed',
      }),
    });

    const users = [
      {
        id: '1',
        name: 'John Doe',
        email: 'john@example.com',
        age: 30,
        active: true,
      },
      {
        id: '2',
        name: 'Jane Smith',
        email: 'jane@example.com',
        age: 25,
        active: false,
      },
    ];

    const response = await callGeneratedClient(
      client,
      mockFetch,
      'processUsers',
      users,
    );

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/process-users`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(users),
      }),
    );
    expect(response).toEqual({
      processed: 2,
      status: 'completed',
    });
  });

  it('should handle operation which returns an array of strings', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/get-categories': {
          get: {
            operationId: 'getCategories',
            description: 'Get an array of category names',
            parameters: [
              {
                name: 'filter',
                in: 'query',
                schema: { type: 'string' },
              },
            ],
            responses: {
              '200': {
                description: 'List of categories',
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
    const expectedCategories = ['electronics', 'clothing', 'books', 'home'];
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue(expectedCategories),
    });

    const response = await callGeneratedClient(
      client,
      mockFetch,
      'getCategories',
      {
        filter: 'active',
      },
    );

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/get-categories?filter=active`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(response).toEqual(expectedCategories);
  });

  it('should handle operation which returns an array of objects', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/get-products': {
          get: {
            operationId: 'getProducts',
            description: 'Get an array of product objects',
            parameters: [
              {
                name: 'category',
                in: 'query',
                schema: { type: 'string' },
              },
              {
                name: 'limit',
                in: 'query',
                schema: { type: 'number' },
              },
            ],
            responses: {
              '200': {
                description: 'List of products',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          name: { type: 'string' },
                          price: { type: 'number' },
                          description: { type: 'string' },
                          inStock: { type: 'boolean' },
                          tags: {
                            type: 'array',
                            items: { type: 'string' },
                          },
                          metadata: {
                            type: 'object',
                            properties: {
                              weight: { type: 'number' },
                              dimensions: { type: 'string' },
                            },
                          },
                        },
                        required: ['id', 'name', 'price'],
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
    const expectedProducts = [
      {
        id: 'prod-1',
        name: 'Laptop',
        price: 999.99,
        description: 'High-performance laptop',
        inStock: true,
        tags: ['electronics', 'computers'],
        metadata: {
          weight: 2.5,
          dimensions: '30x20x2 cm',
        },
      },
      {
        id: 'prod-2',
        name: 'Mouse',
        price: 29.99,
        description: 'Wireless mouse',
        inStock: false,
        tags: ['electronics', 'accessories'],
        metadata: {
          weight: 0.1,
          dimensions: '10x6x3 cm',
        },
      },
    ];

    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue(expectedProducts),
    });

    const response = await callGeneratedClient(
      client,
      mockFetch,
      'getProducts',
      {
        category: 'electronics',
        limit: 10,
      },
    );

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/get-products?category=electronics&limit=10`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(response).toEqual(expectedProducts);
  });

  it('should handle operation which accepts an array of objects referenced from components', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      components: {
        schemas: {
          Customer: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              email: { type: 'string', format: 'email' },
              phone: { type: 'string' },
              address: {
                type: 'object',
                properties: {
                  street: { type: 'string' },
                  city: { type: 'string' },
                  country: { type: 'string' },
                  zipCode: { type: 'string' },
                },
                required: ['street', 'city', 'country'],
              },
              preferences: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            required: ['id', 'name', 'email'],
          },
        },
      },
      paths: {
        '/batch-customers': {
          post: {
            operationId: 'batchCreateCustomers',
            description:
              'Create multiple customers from referenced component schema',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: {
                      $ref: '#/components/schemas/Customer',
                    },
                  },
                },
              },
            },
            responses: {
              '201': {
                description: 'Customers created successfully',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        created: { type: 'number' },
                        customerIds: {
                          type: 'array',
                          items: { type: 'string' },
                        },
                      },
                      required: ['created', 'customerIds'],
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
      status: 201,
      json: vi.fn().mockResolvedValue({
        created: 2,
        customerIds: ['cust-001', 'cust-002'],
      }),
    });

    const customers = [
      {
        id: 'cust-001',
        name: 'Alice Johnson',
        email: 'alice@example.com',
        phone: '+1-555-0101',
        address: {
          street: '123 Main St',
          city: 'New York',
          country: 'USA',
          zipCode: '10001',
        },
        preferences: ['email-notifications', 'sms-alerts'],
      },
      {
        id: 'cust-002',
        name: 'Bob Smith',
        email: 'bob@example.com',
        phone: '+1-555-0102',
        address: {
          street: '456 Oak Ave',
          city: 'Los Angeles',
          country: 'USA',
        },
        preferences: ['email-notifications'],
      },
    ];

    const response = await callGeneratedClient(
      client,
      mockFetch,
      'batchCreateCustomers',
      customers,
    );

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/batch-customers`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(customers),
      }),
    );
    expect(response).toEqual({
      created: 2,
      customerIds: ['cust-001', 'cust-002'],
    });
  });

  it('should handle operation which returns an array of objects referenced from components', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      components: {
        schemas: {
          Order: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              customerId: { type: 'string' },
              status: {
                type: 'string',
                enum: [
                  'pending',
                  'processing',
                  'shipped',
                  'delivered',
                  'cancelled',
                ],
              },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    productId: { type: 'string' },
                    quantity: { type: 'number' },
                    price: { type: 'number' },
                  },
                  required: ['productId', 'quantity', 'price'],
                },
              },
              totalAmount: { type: 'number' },
              shippingAddress: {
                type: 'object',
                properties: {
                  street: { type: 'string' },
                  city: { type: 'string' },
                  country: { type: 'string' },
                  zipCode: { type: 'string' },
                },
                required: ['street', 'city', 'country'],
              },
            },
            required: ['id', 'customerId', 'status', 'items', 'totalAmount'],
          },
        },
      },
      paths: {
        '/orders': {
          get: {
            operationId: 'getOrders',
            description: 'Get orders using referenced component schema',
            parameters: [
              {
                name: 'customerId',
                in: 'query',
                schema: { type: 'string' },
              },
              {
                name: 'status',
                in: 'query',
                schema: {
                  type: 'string',
                  enum: [
                    'pending',
                    'processing',
                    'shipped',
                    'delivered',
                    'cancelled',
                  ],
                },
              },
              {
                name: 'limit',
                in: 'query',
                schema: { type: 'number' },
              },
            ],
            responses: {
              '200': {
                description: 'List of orders',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: {
                        $ref: '#/components/schemas/Order',
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
    const expectedOrders = [
      {
        id: 'order-001',
        customerId: 'cust-001',
        status: 'processing',
        items: [
          {
            productId: 'prod-001',
            quantity: 2,
            price: 29.99,
          },
          {
            productId: 'prod-002',
            quantity: 1,
            price: 149.99,
          },
        ],
        totalAmount: 209.97,
        shippingAddress: {
          street: '123 Main St',
          city: 'New York',
          country: 'USA',
          zipCode: '10001',
        },
      },
      {
        id: 'order-002',
        customerId: 'cust-001',
        status: 'shipped',
        items: [
          {
            productId: 'prod-003',
            quantity: 1,
            price: 79.99,
          },
        ],
        totalAmount: 79.99,
        shippingAddress: {
          street: '123 Main St',
          city: 'New York',
          country: 'USA',
          zipCode: '10001',
        },
      },
    ];

    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue(expectedOrders),
    });

    const response = await callGeneratedClient(client, mockFetch, 'getOrders', {
      customerId: 'cust-001',
      status: 'processing',
      limit: 10,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/orders?customerId=cust-001&status=processing&limit=10`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(response).toEqual(expectedOrders);
  });
});
