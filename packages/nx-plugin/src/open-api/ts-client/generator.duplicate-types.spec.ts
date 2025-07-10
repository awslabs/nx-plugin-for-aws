/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { openApiTsClientGenerator } from './generator';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { Spec } from '../utils/types';
import { Tree } from '@nx/devkit';
import { expectTypeScriptToCompile } from '../../utils/test/ts.spec';

describe('openApiTsClientGenerator - duplicate types', () => {
  let tree: Tree;
  const title = 'TestApi';

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const validateTypeScript = (paths: string[]) => {
    expectTypeScriptToCompile(tree, paths);
  };

  it('should handle duplicate type names between schema and operation request types', async () => {
    // This test reproduces the issue where a schema component has the same name
    // as what would be generated for an operation request type
    const spec: Spec = {
      openapi: '3.1.0',
      info: { title, version: '0.1.0' },
      paths: {
        '/chat': {
          post: {
            operationId: 'chat',
            summary: 'Chat',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/ChatRequest',
                  },
                },
              },
              required: true,
            },
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/ChatResponse',
                    },
                  },
                },
                description: 'Successful Response',
              },
              '422': {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/HTTPValidationError',
                    },
                  },
                },
                description: 'Validation Error',
              },
              '500': {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/InternalServerErrorDetails',
                    },
                  },
                },
                description: 'Internal Server Error',
              },
            },
          },
        },
      },
      components: {
        schemas: {
          ChatRequest: {
            properties: {
              message: {
                title: 'Message',
                type: 'string',
              },
            },
            required: ['message'],
            title: 'ChatRequest',
            type: 'object',
          },
          ChatResponse: {
            properties: {
              message: {
                title: 'Message',
                type: 'string',
              },
            },
            required: ['message'],
            title: 'ChatResponse',
            type: 'object',
          },
          HTTPValidationError: {
            properties: {
              detail: {
                items: {
                  $ref: '#/components/schemas/ValidationError',
                },
                title: 'Detail',
                type: 'array',
              },
            },
            title: 'HTTPValidationError',
            type: 'object',
          },
          InternalServerErrorDetails: {
            properties: {
              detail: {
                title: 'Detail',
                type: 'string',
              },
            },
            required: ['detail'],
            title: 'InternalServerErrorDetails',
            type: 'object',
          },
          ValidationError: {
            properties: {
              loc: {
                items: {
                  anyOf: [
                    {
                      type: 'string',
                    },
                    {
                      type: 'integer',
                    },
                  ],
                },
                title: 'Location',
                type: 'array',
              },
              msg: {
                title: 'Message',
                type: 'string',
              },
              type: {
                title: 'Error Type',
                type: 'string',
              },
            },
            required: ['loc', 'msg', 'type'],
            title: 'ValidationError',
            type: 'object',
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

    // Check that there are no duplicate type definitions
    const chatRequestMatches = (types || '').match(/export type ChatRequest/g);
    expect(chatRequestMatches).toHaveLength(1);

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    expect(client).toMatchSnapshot();
  });

  it('should handle multiple potential conflicts gracefully', async () => {
    // Test multiple operations that could conflict with schema names
    const spec: Spec = {
      openapi: '3.1.0',
      info: { title, version: '0.1.0' },
      paths: {
        '/user': {
          post: {
            operationId: 'user',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/UserRequest',
                  },
                },
              },
              required: true,
            },
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/User',
                    },
                  },
                },
                description: 'Success',
              },
            },
          },
        },
        '/order': {
          post: {
            operationId: 'order',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/OrderRequest',
                  },
                },
              },
              required: true,
            },
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/Order',
                    },
                  },
                },
                description: 'Success',
              },
            },
          },
        },
      },
      components: {
        schemas: {
          UserRequest: {
            properties: {
              name: { type: 'string' },
            },
            required: ['name'],
            title: 'UserRequest',
            type: 'object',
          },
          User: {
            properties: {
              id: { type: 'integer' },
              name: { type: 'string' },
            },
            required: ['id', 'name'],
            title: 'User',
            type: 'object',
          },
          OrderRequest: {
            properties: {
              productId: { type: 'integer' },
            },
            required: ['productId'],
            title: 'OrderRequest',
            type: 'object',
          },
          Order: {
            properties: {
              id: { type: 'integer' },
              productId: { type: 'integer' },
              status: { type: 'string' },
            },
            required: ['id', 'productId', 'status'],
            title: 'Order',
            type: 'object',
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

    // Verify no duplicate type definitions
    const userRequestMatches = (types || '').match(/export type UserRequest/g);
    expect(userRequestMatches).toHaveLength(1);

    const orderRequestMatches = (types || '').match(
      /export type OrderRequest/g,
    );
    expect(orderRequestMatches).toHaveLength(1);

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    expect(client).toMatchSnapshot();
  });
});
