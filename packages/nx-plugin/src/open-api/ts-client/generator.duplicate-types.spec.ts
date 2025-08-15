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

  it('should handle operation ID matching schema name conflict', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      components: {
        schemas: {
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
                description: 'Success',
                content: {
                  'application/json': {
                    schema: { type: 'string' },
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

    // Verify no duplicate type declarations
    const typeMatches = types?.match(/export type ChatRequest/g) || [];
    expect(typeMatches).toHaveLength(1);
  });

  it('should handle multiple operation ID conflicts', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      components: {
        schemas: {
          UserRequest: {
            type: 'object',
            properties: {
              name: { type: 'string' },
            },
            required: ['name'],
          },
          OrderRequest: {
            type: 'object',
            properties: {
              item: { type: 'string' },
            },
            required: ['item'],
          },
        },
      },
      paths: {
        '/user': {
          post: {
            operationId: 'user',
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
              '200': {
                description: 'Success',
                content: {
                  'application/json': {
                    schema: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        '/order': {
          post: {
            operationId: 'order',
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
              '200': {
                description: 'Success',
                content: {
                  'application/json': {
                    schema: { type: 'string' },
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

    // Verify no duplicate type declarations
    const userTypeMatches = types?.match(/export type UserRequest/g) || [];
    expect(userTypeMatches).toHaveLength(1);

    const orderTypeMatches = types?.match(/export type OrderRequest/g) || [];
    expect(orderTypeMatches).toHaveLength(1);
  });

  it('should handle duplicated model names', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      components: {
        schemas: {
          MyModel: {
            oneOf: [
              {
                title: 'clash',
                type: 'object',
                properties: {
                  message: { type: 'string' },
                },
                required: ['message'],
              },
              {
                type: 'string',
              },
            ],
          },
          Clash: {
            type: 'object',
            properties: {
              anotherProperty: { type: 'string' },
            },
            required: ['anotherProperty'],
          },
        },
      },
      paths: {
        '/operation': {
          post: {
            operationId: 'operation',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/MyModel',
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Success',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Clash' },
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

    // Properties of both of the clashing models should be present, instead of one being erased
    expect(types).toContain('message');
    expect(types).toContain('anotherProperty');
  });

  it('should handle many duplicated model names', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      components: {
        schemas: {
          MyModel: {
            oneOf: [
              {
                title: 'clash',
                type: 'object',
                properties: {
                  prop1: { type: 'string' },
                },
                required: ['prop1'],
              },
              {
                title: 'clash',
                type: 'object',
                properties: {
                  prop2: { type: 'string' },
                },
                required: ['prop2'],
              },
            ],
          },
          Clash: {
            type: 'object',
            properties: {
              prop3: { type: 'string' },
            },
            required: ['prop3'],
          },
          AnotherModel: {
            oneOf: [
              {
                title: 'clash',
                type: 'object',
                properties: {
                  prop4: { type: 'string' },
                },
                required: ['prop4'],
              },
              {
                title: 'clash',
                type: 'object',
                properties: {
                  prop5: { type: 'string' },
                },
                required: ['prop5'],
              },
            ],
          },
        },
      },
      paths: {
        '/operation': {
          post: {
            operationId: 'operation',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/MyModel',
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Success',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Clash' },
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

    // Properties of all of the clashing models should be present
    expect(types).toContain('prop1');
    expect(types).toContain('prop2');
    expect(types).toContain('prop3');
    expect(types).toContain('prop4');
    expect(types).toContain('prop5');
  });
});
