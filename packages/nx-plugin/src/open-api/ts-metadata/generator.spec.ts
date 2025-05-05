/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { Spec } from '../utils/types';
import { openApiTsMetadataGenerator } from './generator';
import { TypeScriptVerifier } from '../ts-client/generator.utils.spec';
import { importTypeScriptModule } from '../../utils/js';

describe('openApiTsMetadataGenerator', () => {
  let tree: Tree;
  const title = 'TestApi';
  const verifier = new TypeScriptVerifier(['@tanstack/react-query']);

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const validateTypeScript = (paths: string[]) => {
    verifier.expectTypeScriptToCompile(tree, paths);
  };

  const importOperationDetails = async (
    metadataModule: string,
  ): Promise<{ [key: string]: { path: string; method: string } }> => {
    // Dynamically import the generated modules
    const { OPERATION_DETAILS } =
      await importTypeScriptModule<any>(metadataModule);
    return OPERATION_DETAILS;
  };

  it('should generate metadata for an operation', async () => {
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

    await openApiTsMetadataGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript(['src/generated/metadata.gen.ts']);

    const metadata = tree.read('src/generated/metadata.gen.ts', 'utf-8');
    expect(metadata).toMatchSnapshot();

    expect(await importOperationDetails(metadata)).toEqual({
      getTest: {
        path: '/test',
        method: 'GET',
      },
    });
  });

  it('should generate metadata for an operation with tags', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      paths: {
        '/users': {
          get: {
            tags: ['users'],
            operationId: 'list',
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
            operationId: 'list',
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

    await openApiTsMetadataGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript(['src/generated/metadata.gen.ts']);

    const metadata = tree.read('src/generated/metadata.gen.ts', 'utf-8');
    expect(metadata).toMatchSnapshot();

    expect(await importOperationDetails(metadata)).toEqual({
      'users.list': {
        path: '/users',
        method: 'GET',
      },
      createUser: {
        path: '/users',
        method: 'POST',
      },
      'items.list': {
        path: '/items',
        method: 'GET',
      },
      getStatus: {
        path: '/status',
        method: 'GET',
      },
    });
  });
});
