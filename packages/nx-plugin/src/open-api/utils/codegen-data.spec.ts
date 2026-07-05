/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { buildOpenApiCodeGenData } from './codegen-data';
import type { Spec } from './types';

describe('openapi codegen data utils', () => {
  describe('buildOpenApiCodeGenData', () => {
    const sampleSpec: Spec = {
      openapi: '3.0.0',
      info: {
        title: 'Test API',
        version: '1.0.0',
      },
      paths: {
        '/pets': {
          get: {
            operationId: 'listPets',
            responses: {
              '200': {
                description: 'List of pets',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: {
                        $ref: '#/components/schemas/Pet',
                      },
                    },
                  },
                },
              },
            },
          },
          post: {
            operationId: 'createPet',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/NewPet',
                  },
                },
              },
            },
            responses: {
              '201': {
                description: 'Pet created',
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/Pet',
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Pet: {
            type: 'object',
            properties: {
              id: { type: 'integer', format: 'int64' },
              name: { type: 'string' },
              tag: { type: 'string' },
              status: {
                type: 'string',
                enum: ['available', 'pending', 'sold'],
              },
            },
            required: ['id', 'name'],
          },
          NewPet: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              tag: { type: 'string' },
            },
            required: ['name'],
          },
          Error: {
            type: 'object',
            properties: {
              code: { type: 'integer', format: 'int32' },
              message: { type: 'string' },
            },
            required: ['code', 'message'],
          },
        },
      },
    };

    it('should generate code gen data with correct structure', async () => {
      const data = await buildOpenApiCodeGenData(sampleSpec);

      // Verify basic structure
      expect(data).toHaveProperty('info', sampleSpec.info);
      expect(data).toHaveProperty('models');
      expect(data).toHaveProperty('services');
      expect(data).toHaveProperty('allOperations');
      expect(data).toHaveProperty('vendorExtensions');
    });

    it('should process models correctly', async () => {
      const data = await buildOpenApiCodeGenData(sampleSpec);

      // Find the Pet model
      const petModel = data.models.find((m) => m.name === 'Pet');
      expect(petModel).toBeDefined();
      expect(petModel).toMatchObject({
        name: 'Pet',
        export: 'interface',
        type: 'Pet',
        properties: expect.arrayContaining([
          expect.objectContaining({ name: 'id', type: 'number' }),
          expect.objectContaining({ name: 'name', type: 'string' }),
          expect.objectContaining({ name: 'tag', type: 'string' }),
          expect.objectContaining({ name: 'status', type: 'PetStatus' }),
        ]),
      });

      // Verify language-specific types were added
      expect(petModel).toHaveProperty('typescriptType');
      expect(petModel).toHaveProperty('pythonType');

      // Find the PetStatus enum
      const petStatusModel = data.models.find((m) => m.name === 'PetStatus');
      expect(petStatusModel).toBeDefined();
      expect(petStatusModel).toMatchObject({
        name: 'PetStatus',
        export: 'enum',
        type: 'string',
        enum: expect.arrayContaining([
          expect.objectContaining({ value: 'available' }),
          expect.objectContaining({ value: 'pending' }),
          expect.objectContaining({ value: 'sold' }),
        ]),
      });
    });

    it('should process operations correctly', async () => {
      const data = await buildOpenApiCodeGenData(sampleSpec);

      // Verify operations were processed
      expect(data.allOperations).toHaveLength(2);

      // Check listPets operation
      const listPetsOp = data.allOperations.find(
        (op) => op.name === 'listPets',
      );
      expect(listPetsOp).toBeDefined();
      expect(listPetsOp).toMatchObject({
        name: 'listPets',
        method: 'GET',
        path: '/pets',
        responses: expect.arrayContaining([
          expect.objectContaining({
            code: 200,
            type: 'Pet',
          }),
        ]),
      });

      // Check createPet operation
      const createPetOp = data.allOperations.find(
        (op) => op.name === 'createPet',
      );
      expect(createPetOp).toBeDefined();
      expect(createPetOp).toMatchObject({
        name: 'createPet',
        method: 'POST',
        path: '/pets',
        parameters: expect.arrayContaining([
          expect.objectContaining({
            in: 'body',
            type: 'NewPet',
          }),
        ]),
      });
    });

    it('should handle composite models', async () => {
      const specWithComposite: Spec = {
        ...sampleSpec,
        components: {
          schemas: {
            ...sampleSpec.components.schemas,
            CompositePet: {
              allOf: [
                { $ref: '#/components/schemas/Pet' },
                {
                  type: 'object',
                  properties: {
                    owner: { type: 'string' },
                  },
                },
              ],
            },
          },
        },
      };

      const data = await buildOpenApiCodeGenData(specWithComposite);

      // Find the composite model
      const compositeModel = data.models.find((m) => m.name === 'CompositePet');
      expect(compositeModel).toBeDefined();
      expect(compositeModel.export).toBe('all-of');
      expect(compositeModel).toHaveProperty('composedModels');
      expect(compositeModel).toHaveProperty('composedPrimitives');
    });

    it('should handle array and dictionary types', async () => {
      const specWithCollections: Spec = {
        ...sampleSpec,
        components: {
          schemas: {
            ...sampleSpec.components.schemas,
            PetArray: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/Pet',
              },
            },
            PetDictionary: {
              type: 'object',
              additionalProperties: {
                $ref: '#/components/schemas/Pet',
              },
            },
          },
        },
      };

      const data = await buildOpenApiCodeGenData(specWithCollections);

      // Check array type
      const arrayModel = data.models.find((m) => m.name === 'PetArray');
      expect(arrayModel).toBeDefined();
      expect(arrayModel.export).toBe('array');
      expect(arrayModel.link).toBeDefined();

      // Check dictionary type
      const dictModel = data.models.find((m) => m.name === 'PetDictionary');
      expect(dictModel).toBeDefined();
      expect(dictModel.export).toBe('dictionary');
      expect(dictModel.link).toBeDefined();
    });

    it('should handle operations without operationId', async () => {
      const specWithoutOperationId: Spec = {
        ...sampleSpec,
        paths: {
          '/pets': {
            get: {
              // No operationId
              responses: {
                '200': {
                  description: 'List of pets',
                  content: {
                    'application/json': {
                      schema: {
                        $ref: '#/components/schemas/Pet',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      };

      const data = await buildOpenApiCodeGenData(specWithoutOperationId);

      // Should generate an operation name based on path and method
      const operation = data.allOperations[0];
      expect(operation.name).toBe('getPets');
    });

    it('should handle vendor extensions', async () => {
      const specWithExtensions: Spec = {
        ...sampleSpec,
        ...{ 'x-custom-root': 'root-value' },
        paths: {
          '/pets': {
            get: {
              operationId: 'listPets',
              ...{ 'x-custom-operation': 'operation-value' },
              responses: {
                '200': {
                  description: 'List of pets',
                  content: {
                    'application/json': {
                      schema: {
                        $ref: '#/components/schemas/Pet',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      };

      const data = await buildOpenApiCodeGenData(specWithExtensions);

      // Check root level extensions
      expect(data.vendorExtensions).toHaveProperty(
        'x-custom-root',
        'root-value',
      );

      // Check operation level extensions
      const operation = data.allOperations[0];
      expect(operation.vendorExtensions).toHaveProperty(
        'x-custom-operation',
        'operation-value',
      );
    });

    it('should throw for allOf composing non-object types', () => {
      const specWithInvalidAllOf: Spec = {
        ...sampleSpec,
        components: {
          schemas: {
            ...sampleSpec.components.schemas,
            StringAndPet: {
              allOf: [{ type: 'string' }, { $ref: '#/components/schemas/Pet' }],
            },
          },
        },
      };

      expect(() => buildOpenApiCodeGenData(specWithInvalidAllOf)).toThrow(
        /allOf with non-object types/,
      );
    });

    it('should classify operations as query or mutation by method', async () => {
      const data = await buildOpenApiCodeGenData(sampleSpec);

      const listPetsOp = data.allOperations.find(
        (op) => op.name === 'listPets',
      );
      expect(listPetsOp).toMatchObject({ isQuery: true, isMutation: false });

      const createPetOp = data.allOperations.find(
        (op) => op.name === 'createPet',
      );
      expect(createPetOp).toMatchObject({ isQuery: false, isMutation: true });
    });

    it('should let x-query and x-mutation override the method default', async () => {
      const specWithOverrides: Spec = {
        ...sampleSpec,
        paths: {
          '/pets': {
            get: {
              operationId: 'listPets',
              ...{ 'x-mutation': true },
              responses: {
                '200': {
                  description: 'List of pets',
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/Pet' },
                    },
                  },
                },
              },
            },
            post: {
              operationId: 'queryPets',
              ...{ 'x-query': true },
              requestBody: {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/NewPet' },
                  },
                },
              },
              responses: {
                '200': {
                  description: 'Queried pets',
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/Pet' },
                    },
                  },
                },
              },
            },
          },
        },
      };

      const data = await buildOpenApiCodeGenData(specWithOverrides);

      const getOp = data.allOperations.find((op) => op.name === 'listPets');
      expect(getOp).toMatchObject({ isMutation: true, isQuery: false });

      const postOp = data.allOperations.find((op) => op.name === 'queryPets');
      expect(postOp).toMatchObject({ isMutation: false, isQuery: true });
    });

    const paginatedSpec = (
      cursorExtension: Record<string, unknown>,
      cursorParamName = 'cursor',
    ): Spec => ({
      ...sampleSpec,
      paths: {
        '/pets': {
          get: {
            operationId: 'listPets',
            ...cursorExtension,
            parameters: [
              {
                name: cursorParamName,
                in: 'query',
                schema: { type: 'string' },
              },
            ],
            responses: {
              '200': {
                description: 'List of pets',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Pet' },
                  },
                },
              },
            },
          },
        },
      },
    });

    it('should treat a query with a cursor parameter as an infinite query', async () => {
      const data = await buildOpenApiCodeGenData(paginatedSpec({}));

      const op = data.allOperations.find((o) => o.name === 'listPets');
      expect(op.isInfiniteQuery).toBe(true);
      expect(op.infiniteQueryCursorProperty).toMatchObject({ name: 'cursor' });
    });

    it('should page on the property named by a string x-cursor', async () => {
      const data = await buildOpenApiCodeGenData(
        paginatedSpec({ 'x-cursor': 'nextToken' }, 'nextToken'),
      );

      const op = data.allOperations.find((o) => o.name === 'listPets');
      expect(op.isInfiniteQuery).toBe(true);
      expect(op.infiniteQueryCursorProperty).toMatchObject({
        name: 'nextToken',
      });
    });

    it('should page on the property named by x-cursor inputToken', async () => {
      const data = await buildOpenApiCodeGenData(
        paginatedSpec({ 'x-cursor': { inputToken: 'nextToken' } }, 'nextToken'),
      );

      const op = data.allOperations.find((o) => o.name === 'listPets');
      expect(op.isInfiniteQuery).toBe(true);
      expect(op.infiniteQueryCursorProperty).toMatchObject({
        name: 'nextToken',
      });
    });

    it('should disable pagination when x-cursor is false', async () => {
      const data = await buildOpenApiCodeGenData(
        paginatedSpec({ 'x-cursor': false }),
      );

      const op = data.allOperations.find((o) => o.name === 'listPets');
      expect(op.isInfiniteQuery).toBe(false);
      expect(op.infiniteQueryCursorProperty).toBeUndefined();
    });

    it('should disable pagination when x-cursor sets enabled to false', async () => {
      const data = await buildOpenApiCodeGenData(
        paginatedSpec({ 'x-cursor': { enabled: false } }),
      );

      const op = data.allOperations.find((o) => o.name === 'listPets');
      expect(op.isInfiniteQuery).toBe(false);
      expect(op.infiniteQueryCursorProperty).toBeUndefined();
    });
  });
});
