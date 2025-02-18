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
      const operation = data.allOperations[0] as any;
      expect(operation.vendorExtensions).toHaveProperty(
        'x-custom-operation',
        'operation-value',
      );
    });
  });
});
