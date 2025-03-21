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

describe('openApiTsClientGenerator - tags', () => {
  let tree: Tree;
  const title = 'TestApi';

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const validateTypeScript = (paths: string[]) => {
    expectTypeScriptToCompile(tree, paths);
  };

  it('should handle operation tags and multiple services', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/users': {
          get: {
            tags: ['users'],
            operationId: 'getUsers',
            responses: {
              '200': {
                description: 'test',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
          post: {
            tags: ['users'],
            operationId: 'createUser',
            responses: {
              '201': {
                description: 'test',
                content: {
                  'application/json': {
                    schema: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        '/items': {
          get: {
            tags: ['items'],
            operationId: 'getItems',
            description: 'Returns a list of all the items',
            responses: {
              '200': {
                description: 'test',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        '/status': {
          get: {
            operationId: 'getStatus',
            responses: {
              '200': {
                description: 'test',
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

    const mockFetch = vi.fn();

    // Test getUsers
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue(['user1', 'user2', 'user3']),
    });

    const users = await callGeneratedClient(
      client,
      mockFetch,
      'users.getUsers',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/users`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(users).toEqual(['user1', 'user2', 'user3']);

    // Test createUser
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 201,
      text: vi.fn().mockResolvedValue('newUser123'),
    });

    const newUser = await callGeneratedClient(
      client,
      mockFetch,
      'users.createUser',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/users`,
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(newUser).toBe('newUser123');

    // Test getItems
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue(['item1', 'item2']),
    });

    const items = await callGeneratedClient(
      client,
      mockFetch,
      'items.getItems',
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/items`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(items).toEqual(['item1', 'item2']);

    // Test getStatus
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue('healthy'),
    });

    const status = await callGeneratedClient(client, mockFetch, 'getStatus');
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/status`,
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(status).toBe('healthy');
  });

  it('should handle operations with multiple tags', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/multi-tagged': {
          get: {
            tags: ['tag1', 'tag2', 'tag3'],
            operationId: 'getMultiTagged',
            responses: {
              '200': {
                description: 'test',
                content: {
                  'application/json': {
                    schema: { type: 'string' },
                  },
                },
              },
            },
          },
          post: {
            tags: ['tag1', 'tag3'],
            operationId: 'postMultiTagged',
            responses: {
              '200': {
                description: 'test',
                content: {
                  'application/json': {
                    schema: { type: 'number' },
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

    // Check that the client has the methods under the appropriate tags
    const { TestApi } = await importTypeScriptModule<any>(client);
    const c = new TestApi({ url: baseUrl, fetch: vi.fn() });

    expect(c.tag1.getMultiTagged).toBeDefined();
    expect(c.tag2.getMultiTagged).toBeDefined();
    expect(c.tag3.getMultiTagged).toBeDefined();

    expect(c.tag1.postMultiTagged).toBeDefined();
    expect(c.tag2.postMultiTagged).not.toBeDefined();
    expect(c.tag3.postMultiTagged).toBeDefined();
  });

  it('should allow duplicate operation ids discriminated by tag', async () => {
    const spec: Spec = {
      info: {
        title,
        version: '1.0.0',
      },
      openapi: '3.0.0',
      paths: {
        '/items': {
          get: {
            tags: ['items'],
            operationId: 'list',
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
        '/users': {
          get: {
            tags: ['users'],
            operationId: 'list',
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

    const types = tree.read('src/generated/types.gen.ts', 'utf-8');
    expect(types).toMatchSnapshot();

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    expect(client).toMatchSnapshot();

    const mockFetch = vi.fn();

    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue(['a', 'b', 'c']),
    });

    expect(await callGeneratedClient(client, mockFetch, 'users.list')).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(await callGeneratedClient(client, mockFetch, 'items.list')).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('should allow duplicate operation ids discriminated by multiple tags', async () => {
    const spec: Spec = {
      info: {
        title,
        version: '1.0.0',
      },
      openapi: '3.0.0',
      paths: {
        '/items': {
          get: {
            tags: ['items', 'stock'],
            operationId: 'list',
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
        '/users': {
          get: {
            tags: ['users', 'people'],
            operationId: 'list',
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

    const types = tree.read('src/generated/types.gen.ts', 'utf-8');
    expect(types).toMatchSnapshot();

    const client = tree.read('src/generated/client.gen.ts', 'utf-8');
    expect(client).toMatchSnapshot();

    const mockFetch = vi.fn();

    mockFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue(['a', 'b', 'c']),
    });

    expect(await callGeneratedClient(client, mockFetch, 'users.list')).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(await callGeneratedClient(client, mockFetch, 'people.list')).toEqual(
      ['a', 'b', 'c'],
    );
    expect(await callGeneratedClient(client, mockFetch, 'items.list')).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(await callGeneratedClient(client, mockFetch, 'stock.list')).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('should throw for operations with the same id and no tags', async () => {
    const spec: Spec = {
      info: {
        title,
        version: '1.0.0',
      },
      openapi: '3.0.0',
      paths: {
        '/items': {
          get: {
            operationId: 'myOp',
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
        '/users': {
          get: {
            operationId: 'myOp',
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

    await expect(
      openApiTsClientGenerator(tree, {
        openApiSpecPath: 'openapi.json',
        outputPath: 'src/generated',
      }),
    ).rejects.toThrow(
      'Untagged operations cannot have the same operationId (myOp)',
    );
  });

  it('should throw an error for duplicate operation ids within a tag', async () => {
    const spec: Spec = {
      info: {
        title,
        version: '1.0.0',
      },
      openapi: '3.0.0',
      paths: {
        '/items': {
          get: {
            tags: ['items', 'users'],
            operationId: 'list',
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
        '/users': {
          get: {
            tags: ['users'],
            operationId: 'list',
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

    await expect(
      openApiTsClientGenerator(tree, {
        openApiSpecPath: 'openapi.json',
        outputPath: 'src/generated',
      }),
    ).rejects.toThrow(
      'Operations with the same tag (users) cannot have the same operationId (list)',
    );
  });
});
