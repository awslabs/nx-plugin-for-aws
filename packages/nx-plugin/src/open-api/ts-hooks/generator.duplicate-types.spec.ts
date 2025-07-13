/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { Spec } from '../utils/types';
import { openApiTsHooksGenerator } from './generator';
import { TypeScriptVerifier } from '../../utils/test/ts.spec';

describe('openApiTsHooksGenerator - Duplicate Types', () => {
  let tree: Tree;
  const title = 'TestApi';
  const verifier = new TypeScriptVerifier(['@tanstack/react-query']);

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const validateTypeScript = (paths: string[]) => {
    verifier.expectTypeScriptToCompile(tree, paths);
  };

  it('should handle duplicate type names when operation ID matches schema name', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      components: {
        schemas: {
          // This schema conflicts with the request type that would be generated for the 'chat' operation
          ChatRequest: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
            required: ['message'],
          },
        },
      },
      paths: {
        '/chat': {
          post: {
            operationId: 'chat',
            description: 'Send a chat message',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/ChatRequest',
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Chat response',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        reply: { type: 'string' },
                      },
                      required: ['reply'],
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

    await openApiTsHooksGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
      'src/generated/options-proxy.gen.ts',
    ]);

    const typesContent = tree.read('src/generated/types.gen.ts', 'utf-8');
    const optionsProxyContent = tree.read(
      'src/generated/options-proxy.gen.ts',
      'utf-8',
    );

    // Verify that the original schema is preserved
    expect(typesContent).toContain('export type ChatRequest = {');
    expect(typesContent).toContain('message: string;');

    // Verify that the operation request type is renamed to avoid conflict
    expect(typesContent).toContain(
      'export type ChatOperationRequest = ChatRequest;',
    );

    // Verify that the options proxy imports the correct type
    expect(optionsProxyContent).toContain('ChatOperationRequest,');

    // Verify the generated options proxy content
    expect(optionsProxyContent).toMatchSnapshot();
  });

  it('should handle multiple duplicate type names correctly', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      components: {
        schemas: {
          // Multiple conflicting schemas
          UserRequest: {
            type: 'object',
            properties: {
              id: { type: 'string' },
            },
            required: ['id'],
          },
          OrderRequest: {
            type: 'object',
            properties: {
              productId: { type: 'string' },
            },
            required: ['productId'],
          },
        },
      },
      paths: {
        '/users': {
          post: {
            operationId: 'user',
            description: 'Create a user',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/UserRequest',
                  },
                },
              },
            },
            responses: {
              '201': {
                description: 'User created',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
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
        '/orders': {
          post: {
            operationId: 'order',
            description: 'Create an order',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/OrderRequest',
                  },
                },
              },
            },
            responses: {
              '201': {
                description: 'Order created',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        total: { type: 'number' },
                      },
                      required: ['id', 'total'],
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

    await openApiTsHooksGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
      'src/generated/options-proxy.gen.ts',
    ]);

    const typesContent = tree.read('src/generated/types.gen.ts', 'utf-8');
    const optionsProxyContent = tree.read(
      'src/generated/options-proxy.gen.ts',
      'utf-8',
    );

    // Verify that the original schemas are preserved
    expect(typesContent).toContain('export type UserRequest = {');
    expect(typesContent).toContain('export type OrderRequest = {');

    // Verify that both operation request types are renamed to avoid conflicts
    expect(typesContent).toContain(
      'export type UserOperationRequest = UserRequest;',
    );
    expect(typesContent).toContain(
      'export type OrderOperationRequest = OrderRequest;',
    );

    // Verify that the options proxy imports the correct types
    expect(optionsProxyContent).toContain('UserOperationRequest,');
    expect(optionsProxyContent).toContain('OrderOperationRequest,');

    // Verify the generated options proxy content
    expect(optionsProxyContent).toMatchSnapshot();
  });

  it('should not rename when there are no conflicts', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      components: {
        schemas: {
          // This schema does NOT conflict with any operation request type
          UserData: {
            type: 'object',
            properties: {
              name: { type: 'string' },
            },
            required: ['name'],
          },
        },
      },
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            description: 'Create a user',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/UserData',
                  },
                },
              },
            },
            responses: {
              '201': {
                description: 'User created',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
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

    await openApiTsHooksGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
      'src/generated/options-proxy.gen.ts',
    ]);

    const typesContent = tree.read('src/generated/types.gen.ts', 'utf-8');
    const optionsProxyContent = tree.read(
      'src/generated/options-proxy.gen.ts',
      'utf-8',
    );

    // Verify that the original schema is preserved
    expect(typesContent).toContain('export type UserData = {');

    // Verify that the operation request type uses the standard naming (no conflict)
    expect(typesContent).toContain('export type CreateUserRequest = UserData;');

    // Verify that the options proxy imports the standard type name
    expect(optionsProxyContent).toContain('CreateUserRequest,');

    // Should NOT contain the OperationRequest suffix since there's no conflict
    expect(typesContent).not.toContain('CreateUserOperationRequest');

    // Verify the generated options proxy content
    expect(optionsProxyContent).toMatchSnapshot();
  });

  it('should handle query operations with duplicate type names', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      components: {
        schemas: {
          // This schema conflicts with the request type that would be generated for the 'search' operation
          SearchRequest: {
            type: 'object',
            properties: {
              query: { type: 'string' },
            },
            required: ['query'],
          },
        },
      },
      paths: {
        '/search': {
          get: {
            operationId: 'search',
            description: 'Search for items',
            parameters: [
              {
                name: 'query',
                in: 'query',
                required: true,
                schema: { type: 'string' },
              },
              {
                name: 'limit',
                in: 'query',
                required: false,
                schema: { type: 'integer', default: 10 },
              },
            ],
            responses: {
              '200': {
                description: 'Search results',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        results: {
                          type: 'array',
                          items: { type: 'string' },
                        },
                      },
                      required: ['results'],
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

    await openApiTsHooksGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
      'src/generated/options-proxy.gen.ts',
    ]);

    const typesContent = tree.read('src/generated/types.gen.ts', 'utf-8');
    const optionsProxyContent = tree.read(
      'src/generated/options-proxy.gen.ts',
      'utf-8',
    );

    // Verify that the original schema is preserved
    expect(typesContent).toContain('export type SearchRequest = {');
    expect(typesContent).toContain('query: string;');

    // Verify that the operation request type is renamed to avoid conflict
    expect(typesContent).toContain(
      'export type SearchOperationRequest = SearchRequestQueryParameters',
    );

    // Verify that the options proxy imports the correct type
    expect(optionsProxyContent).toContain('SearchOperationRequest,');

    // Verify the generated options proxy content
    expect(optionsProxyContent).toMatchSnapshot();
  });

  it('should handle mutation operations with duplicate type names', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      components: {
        schemas: {
          // This schema conflicts with the request type that would be generated for the 'update' operation
          UpdateRequest: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              data: { type: 'object' },
            },
            required: ['id', 'data'],
          },
        },
      },
      paths: {
        '/items/{id}': {
          put: {
            operationId: 'update',
            description: 'Update an item',
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/UpdateRequest',
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Item updated',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        success: { type: 'boolean' },
                      },
                      required: ['success'],
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

    await openApiTsHooksGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
      'src/generated/options-proxy.gen.ts',
    ]);

    const typesContent = tree.read('src/generated/types.gen.ts', 'utf-8');
    const optionsProxyContent = tree.read(
      'src/generated/options-proxy.gen.ts',
      'utf-8',
    );

    // Verify that the original schema is preserved
    expect(typesContent).toContain('export type UpdateRequest = {');
    expect(typesContent).toContain('id: string;');
    expect(typesContent).toContain('data: { [key: string]: unknown };');

    // Verify that the operation request type is renamed to avoid conflict
    expect(typesContent).toContain(
      'export type UpdateOperationRequest = UpdateRequestPathParameters &',
    );

    // Verify that the options proxy imports the correct type
    expect(optionsProxyContent).toContain('UpdateOperationRequest,');

    // Verify the generated options proxy content
    expect(optionsProxyContent).toMatchSnapshot();
  });
});
