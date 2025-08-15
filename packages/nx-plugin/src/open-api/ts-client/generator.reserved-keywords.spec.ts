/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { openApiTsClientGenerator } from './generator';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { Spec } from '../utils/types';
import { Tree } from '@nx/devkit';
import { expectTypeScriptToCompile } from '../../utils/test/ts.spec';

describe('openApiTsClientGenerator - reserved keywords', () => {
  let tree: Tree;
  const title = 'TestApi';

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const validateTypeScript = (paths: string[]) => {
    expectTypeScriptToCompile(tree, paths);
  };

  it('should handle reserved language keywords', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      components: {
        schemas: {
          ReservedProperties: {
            type: 'object',
            properties: {
              for: { type: 'string' },
              while: { type: 'string' },
              if: { type: 'string' },
              else: { type: 'number' },
              function: { type: 'boolean' },
              var: { type: 'string' },
              let: { type: 'string' },
              const: { type: 'string' },
              return: { type: 'string' },
              break: { type: 'string' },
              continue: { type: 'string' },
              switch: { type: 'string' },
              case: { type: 'string' },
              default: { type: 'string' },
              try: { type: 'string' },
              catch: { type: 'string' },
              finally: { type: 'string' },
              throw: { type: 'string' },
              new: { type: 'string' },
              this: { type: 'string' },
              super: { type: 'string' },
              class: { type: 'string' },
              extends: { type: 'string' },
              implements: { type: 'string' },
              interface: { type: 'string' },
              enum: { type: 'string' },
              type: { type: 'string' },
              namespace: { type: 'string' },
              module: { type: 'string' },
              import: { type: 'string' },
              export: { type: 'string' },
              from: { type: 'string' },
              as: { type: 'string' },
              async: { type: 'string' },
              await: { type: 'string' },
              yield: { type: 'string' },
              typeof: { type: 'string' },
              instanceof: { type: 'string' },
              in: { type: 'string' },
              of: { type: 'string' },
              with: { type: 'string' },
              do: { type: 'string' },
              null: { type: 'string' },
              undefined: { type: 'string' },
              true: { type: 'string' },
              false: { type: 'string' },
            },
            required: ['while', 'if', 'else', 'function'],
          },
          for: { type: 'string' },
          while: { type: 'string' },
          if: { type: 'string' },
          else: { type: 'string' },
          function: { type: 'string' },
          var: { type: 'string' },
          let: { type: 'string' },
          const: { type: 'string' },
          return: { type: 'string' },
          break: { type: 'string' },
          continue: { type: 'string' },
          switch: { type: 'string' },
          case: { type: 'string' },
          default: { type: 'string' },
          try: { type: 'string' },
          catch: { type: 'string' },
          finally: { type: 'string' },
          throw: { type: 'string' },
          new: { type: 'string' },
          this: { type: 'string' },
          super: { type: 'string' },
          class: { type: 'string' },
          extends: { type: 'string' },
          implements: { type: 'string' },
          interface: { type: 'string' },
          enum: { type: 'string' },
          type: { type: 'string' },
          namespace: { type: 'string' },
          module: { type: 'string' },
          import: { type: 'string' },
          export: { type: 'string' },
          from: { type: 'string' },
          as: { type: 'string' },
          async: { type: 'string' },
          await: { type: 'string' },
          yield: { type: 'string' },
          typeof: { type: 'string' },
          instanceof: { type: 'string' },
          in: { type: 'string' },
          of: { type: 'string' },
          with: { type: 'string' },
          do: { type: 'string' },
          null: { type: 'string' },
          undefined: { type: 'string' },
          true: { type: 'string' },
          false: { type: 'string' },
        },
      },
      paths: {
        '/op': {
          post: {
            operationId: 'op',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/ReservedProperties',
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
  });

  it('should handle reserved TypeScript object built-ins', async () => {
    const spec: Spec = {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
      components: {
        schemas: {
          Date: {
            type: 'object',
            properties: {
              timestamp: { type: 'string' },
            },
            required: ['timestamp'],
          },
          Blob: {
            type: 'object',
            properties: {
              data: { type: 'string' },
            },
            required: ['data'],
          },
          Object: {
            type: 'object',
            properties: {
              value: { type: 'string' },
            },
            required: ['value'],
          },
          String: {
            type: 'object',
            properties: {
              content: { type: 'string' },
            },
            required: ['content'],
          },
          Boolean: {
            type: 'object',
            properties: {
              flag: { type: 'boolean' },
            },
            required: ['flag'],
          },
          Number: {
            type: 'object',
            properties: {
              value: { type: 'number' },
            },
            required: ['value'],
          },
          Array: {
            type: 'object',
            properties: {
              items: { type: 'array', items: { type: 'string' } },
            },
            required: ['items'],
          },
          Function: {
            type: 'object',
            properties: {
              name: { type: 'string' },
            },
            required: ['name'],
          },
          Promise: {
            type: 'object',
            properties: {
              result: { type: 'string' },
            },
            required: ['result'],
          },
          Error: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
            required: ['message'],
          },
          Map: {
            type: 'object',
            properties: {
              entries: { type: 'object' },
            },
            required: ['entries'],
          },
          Set: {
            type: 'object',
            properties: {
              values: { type: 'array', items: { type: 'string' } },
            },
            required: ['values'],
          },
          Symbol: {
            type: 'object',
            properties: {
              description: { type: 'string' },
            },
            required: ['description'],
          },
          RegExp: {
            type: 'object',
            properties: {
              pattern: { type: 'string' },
            },
            required: ['pattern'],
          },
          JSON: {
            type: 'object',
            properties: {
              data: { type: 'string' },
            },
            required: ['data'],
          },
        },
      },
      paths: {
        '/reserved-models': {
          post: {
            operationId: 'testReservedModels',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      dateModel: { $ref: '#/components/schemas/Date' },
                      blobModel: { $ref: '#/components/schemas/Blob' },
                      objectModel: { $ref: '#/components/schemas/Object' },
                      stringModel: { $ref: '#/components/schemas/String' },
                      booleanModel: { $ref: '#/components/schemas/Boolean' },
                      numberModel: { $ref: '#/components/schemas/Number' },
                      arrayModel: { $ref: '#/components/schemas/Array' },
                      functionModel: { $ref: '#/components/schemas/Function' },
                      promiseModel: { $ref: '#/components/schemas/Promise' },
                      errorModel: { $ref: '#/components/schemas/Error' },
                      mapModel: { $ref: '#/components/schemas/Map' },
                      setModel: { $ref: '#/components/schemas/Set' },
                      symbolModel: { $ref: '#/components/schemas/Symbol' },
                      regexpModel: { $ref: '#/components/schemas/RegExp' },
                      jsonModel: { $ref: '#/components/schemas/JSON' },
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

    // Verify that reserved model names are prefixed with underscore
    expect(types).toContain('_Date');
    expect(types).toContain('_Blob');
    expect(types).toContain('_Object');
    expect(types).toContain('_String');
    expect(types).toContain('_Boolean');
    expect(types).toContain('_Number');
    expect(types).toContain('_Array');
    expect(types).toContain('_Function');
    expect(types).toContain('_Promise');
    expect(types).toContain('_Error');
    expect(types).toContain('_Map');
    expect(types).toContain('_Set');
    expect(types).toContain('_Symbol');
    expect(types).toContain('_RegExp');
    expect(types).toContain('_JSON');
  });
});
