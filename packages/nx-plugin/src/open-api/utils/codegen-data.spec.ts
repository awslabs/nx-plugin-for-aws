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

    it('should generate code gen data with correct structure', () => {
      const data = buildOpenApiCodeGenData(sampleSpec);

      // Verify basic structure
      expect(data).toHaveProperty('info', sampleSpec.info);
      expect(data).toHaveProperty('models');
      expect(data).toHaveProperty('services');
      expect(data).toHaveProperty('allOperations');
      expect(data).toHaveProperty('vendorExtensions');
    });

    it('should process models correctly', () => {
      const data = buildOpenApiCodeGenData(sampleSpec);

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

    it('should process operations correctly', () => {
      const data = buildOpenApiCodeGenData(sampleSpec);

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

    it('should handle composite models', () => {
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

      const data = buildOpenApiCodeGenData(specWithComposite);

      // Find the composite model
      const compositeModel = data.models.find((m) => m.name === 'CompositePet');
      expect(compositeModel).toBeDefined();
      expect(compositeModel.export).toBe('all-of');
      expect(compositeModel.composedModels.map((m) => m.name)).toContain('Pet');
      expect(compositeModel.composedPrimitives).toHaveLength(0);
    });

    it('should handle array and dictionary types', () => {
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

      const data = buildOpenApiCodeGenData(specWithCollections);

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

    it('should build a value model for inline additionalProperties', () => {
      const spec: Spec = {
        ...sampleSpec,
        components: {
          schemas: {
            ...sampleSpec.components.schemas,
            Counts: {
              type: 'object',
              additionalProperties: { type: 'integer' },
            },
          },
        },
      };

      const model = buildOpenApiCodeGenData(spec).models.find(
        (m) => m.name === 'Counts',
      );
      expect(model.export).toBe('dictionary');
      expect(model.link).toMatchObject({ type: 'number' });
    });

    it('should build value models for patternProperties as an interface', () => {
      const spec: Spec = {
        ...sampleSpec,
        components: {
          schemas: {
            ...sampleSpec.components.schemas,
            Patterned: {
              type: 'object',
              properties: { id: { type: 'string' } },
              ...{ patternProperties: { '^x-': { type: 'string' } } },
            },
          },
        },
      };

      const model = buildOpenApiCodeGenData(spec).models.find(
        (m) => m.name === 'Patterned',
      );
      // Mixing explicit + pattern properties makes it an interface.
      expect(model.export).toBe('interface');
      expect(model.hasPatternProperties).toBe(true);
      expect(model.patternPropertiesModels).toEqual([
        expect.objectContaining({
          pattern: '^x-',
          model: expect.objectContaining({ type: 'string' }),
        }),
      ]);
    });

    it('should build an item model for an inline jsonl streaming itemSchema', () => {
      const spec: Spec = {
        ...sampleSpec,
        paths: {
          '/pets': {
            get: {
              operationId: 'streamPets',
              responses: {
                '200': {
                  description: 'stream',
                  content: {
                    'application/jsonl': {
                      schema: { type: 'string' },
                      ...{ itemSchema: { $ref: '#/components/schemas/Pet' } },
                    },
                  },
                },
              },
            },
          },
        },
      };

      const op = buildOpenApiCodeGenData(spec).allOperations.find(
        (o) => o.name === 'streamPets',
      );
      const response = op.responses[0];
      expect(response.isJsonlStreaming).toBe(true);
      expect(response.itemSchemaModel).toMatchObject({ name: 'Pet' });
    });

    it('should handle operations without operationId', () => {
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

      const data = buildOpenApiCodeGenData(specWithoutOperationId);

      // Should generate an operation name based on path and method
      const operation = data.allOperations[0];
      expect(operation.name).toBe('getPets');
    });

    it('should treat a requestBody with an empty content map as no body', () => {
      const specWithEmptyContent: Spec = {
        ...sampleSpec,
        paths: {
          '/noop': {
            post: {
              operationId: 'doNoop',
              requestBody: { content: {} },
              responses: {
                '200': { description: 'ok' },
              },
            },
          },
        },
      };

      const data = buildOpenApiCodeGenData(specWithEmptyContent);

      const operation = data.allOperations[0];
      expect(operation.parametersBody).toBeNull();
      expect(operation.parameters).toHaveLength(0);
    });

    it('should handle vendor extensions', () => {
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

      const data = buildOpenApiCodeGenData(specWithExtensions);

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

    it('should classify operations as query or mutation by method', () => {
      const data = buildOpenApiCodeGenData(sampleSpec);

      const listPetsOp = data.allOperations.find(
        (op) => op.name === 'listPets',
      );
      expect(listPetsOp).toMatchObject({ isQuery: true, isMutation: false });

      const createPetOp = data.allOperations.find(
        (op) => op.name === 'createPet',
      );
      expect(createPetOp).toMatchObject({ isQuery: false, isMutation: true });
    });

    it('should let x-query and x-mutation override the method default', () => {
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

      const data = buildOpenApiCodeGenData(specWithOverrides);

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

    it('should treat a query with a cursor parameter as an infinite query', () => {
      const data = buildOpenApiCodeGenData(paginatedSpec({}));

      const op = data.allOperations.find((o) => o.name === 'listPets');
      expect(op.isInfiniteQuery).toBe(true);
      expect(op.infiniteQueryCursorProperty).toMatchObject({ name: 'cursor' });
    });

    it('should page on the property named by a string x-cursor', () => {
      const data = buildOpenApiCodeGenData(
        paginatedSpec({ 'x-cursor': 'nextToken' }, 'nextToken'),
      );

      const op = data.allOperations.find((o) => o.name === 'listPets');
      expect(op.isInfiniteQuery).toBe(true);
      expect(op.infiniteQueryCursorProperty).toMatchObject({
        name: 'nextToken',
      });
    });

    it('should page on the property named by x-cursor inputToken', () => {
      const data = buildOpenApiCodeGenData(
        paginatedSpec({ 'x-cursor': { inputToken: 'nextToken' } }, 'nextToken'),
      );

      const op = data.allOperations.find((o) => o.name === 'listPets');
      expect(op.isInfiniteQuery).toBe(true);
      expect(op.infiniteQueryCursorProperty).toMatchObject({
        name: 'nextToken',
      });
    });

    it('should disable pagination when x-cursor is false', () => {
      const data = buildOpenApiCodeGenData(
        paginatedSpec({ 'x-cursor': false }),
      );

      const op = data.allOperations.find((o) => o.name === 'listPets');
      expect(op.isInfiniteQuery).toBe(false);
      expect(op.infiniteQueryCursorProperty).toBeUndefined();
    });

    it('should disable pagination when x-cursor sets enabled to false', () => {
      const data = buildOpenApiCodeGenData(
        paginatedSpec({ 'x-cursor': { enabled: false } }),
      );

      const op = data.allOperations.find((o) => o.name === 'listPets');
      expect(op.isInfiniteQuery).toBe(false);
      expect(op.infiniteQueryCursorProperty).toBeUndefined();
    });

    it('should not be an infinite query when the named cursor param is absent', () => {
      const data = buildOpenApiCodeGenData(
        paginatedSpec({ 'x-cursor': 'missing' }, 'cursor'),
      );

      const op = data.allOperations.find((o) => o.name === 'listPets');
      expect(op.isInfiniteQuery).toBe(false);
    });

    it('should not treat a mutation with a cursor parameter as an infinite query', () => {
      const data = buildOpenApiCodeGenData(
        paginatedSpec({ 'x-mutation': true }),
      );

      const op = data.allOperations.find((o) => o.name === 'listPets');
      expect(op.isMutation).toBe(true);
      expect(op.isInfiniteQuery).toBeFalsy();
    });

    it('should treat a 3.1 [T, "null"] type array as a nullable primary type T', () => {
      const spec: Spec = {
        openapi: '3.1.0',
        info: { title: 'Test API', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {
            Nullable: {
              type: 'object',
              properties: { bar: { type: ['string', 'null'] } },
            },
          },
        },
      };

      const data = buildOpenApiCodeGenData(spec);
      const bar = data.models
        .find((m) => m.name === 'Nullable')
        .properties.find((p) => p.name === 'bar');
      expect(bar).toMatchObject({ type: 'string', isNullable: true });
    });

    const specWithParameterisedOperation = (): Spec => ({
      ...sampleSpec,
      paths: {
        '/pets': {
          post: {
            operationId: 'createPet',
            parameters: [
              { name: 'limit', in: 'query', schema: { type: 'integer' } },
            ],
            responses: {
              '200': {
                description: 'ok',
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

    it('should use the standard Request suffix when the name is free', () => {
      const data = buildOpenApiCodeGenData(specWithParameterisedOperation());

      const op = data.allOperations.find((o) => o.name === 'createPet');
      expect(op.requestTypeName).toBe('CreatePetRequest');
    });

    it('should use the OperationRequest suffix when Request clashes with a schema', () => {
      const spec: Spec = {
        ...specWithParameterisedOperation(),
        components: {
          schemas: {
            ...sampleSpec.components.schemas,
            CreatePetRequest: { type: 'object', properties: {} },
          },
        },
      };

      const op = buildOpenApiCodeGenData(spec).allOperations.find(
        (o) => o.name === 'createPet',
      );
      expect(op.requestTypeName).toBe('CreatePetOperationRequest');
    });

    it('should throw for anyOf composing multiple non-primitive arrays', () => {
      const spec: Spec = {
        ...sampleSpec,
        components: {
          schemas: {
            ...sampleSpec.components.schemas,
            TwoArrays: {
              anyOf: [
                { type: 'array', items: { $ref: '#/components/schemas/Pet' } },
                {
                  type: 'array',
                  items: { $ref: '#/components/schemas/NewPet' },
                },
              ],
            },
          },
        },
      };

      expect(() => buildOpenApiCodeGenData(spec)).toThrow(
        /multiple array types/,
      );
    });

    it('should throw when two properties map to the same TypeScript name', () => {
      const spec: Spec = {
        ...sampleSpec,
        components: {
          schemas: {
            ...sampleSpec.components.schemas,
            Clashing: {
              type: 'object',
              properties: {
                'foo-bar': { type: 'string' },
                foo_bar: { type: 'number' },
              },
            },
          },
        },
      };

      expect(() => buildOpenApiCodeGenData(spec)).toThrow(
        /both map to the TypeScript name "fooBar"/,
      );
    });

    it('should throw when two parameters in one position map to the same name', () => {
      const spec: Spec = {
        ...sampleSpec,
        paths: {
          '/x': {
            get: {
              operationId: 'getX',
              parameters: [
                { name: 'user-id', in: 'query', schema: { type: 'string' } },
                { name: 'user_id', in: 'query', schema: { type: 'number' } },
              ],
              responses: { '200': { description: 'ok' } },
            },
          },
        },
      };

      expect(() => buildOpenApiCodeGenData(spec)).toThrow(
        /both map to the TypeScript name "userId"/,
      );
    });

    it('should allow a query and header parameter to share a name', () => {
      const spec: Spec = {
        ...sampleSpec,
        paths: {
          '/x': {
            get: {
              operationId: 'getX',
              parameters: [
                { name: 'token', in: 'query', schema: { type: 'string' } },
                { name: 'token', in: 'header', schema: { type: 'string' } },
              ],
              responses: { '200': { description: 'ok' } },
            },
          },
        },
      };

      const data = buildOpenApiCodeGenData(spec);
      const op = data.allOperations.find((o) => o.name === 'getX')!;
      // The two parameters live in separate request-position models, so they
      // do not clash.
      expect(op.parameters.filter((p) => p.name === 'token')).toHaveLength(2);
    });

    it('should build discriminator metadata for a discriminated oneOf', () => {
      const spec: Spec = {
        ...sampleSpec,
        components: {
          schemas: {
            ...sampleSpec.components.schemas,
            Cat: {
              type: 'object',
              required: ['kind'],
              properties: { kind: { type: 'string' }, meow: { type: 'boolean' } },
            },
            Dog: {
              type: 'object',
              required: ['kind'],
              properties: { kind: { type: 'string' }, bark: { type: 'boolean' } },
            },
            Animal: {
              oneOf: [
                { $ref: '#/components/schemas/Cat' },
                { $ref: '#/components/schemas/Dog' },
              ],
              discriminator: {
                propertyName: 'kind',
                mapping: {
                  cat: '#/components/schemas/Cat',
                  dog: '#/components/schemas/Dog',
                },
              },
            },
          },
        },
      };

      const data = buildOpenApiCodeGenData(spec);
      const animal = data.models.find((m) => m.name === 'Animal')!;
      expect(animal.discriminator).toEqual({
        propertyName: 'kind',
        typescriptPropertyName: 'kind',
        mapping: [
          { value: 'cat', modelName: 'Cat' },
          { value: 'dog', modelName: 'Dog' },
        ],
      });
    });

    it('should build implicit discriminator mapping from member names', () => {
      const spec: Spec = {
        ...sampleSpec,
        components: {
          schemas: {
            ...sampleSpec.components.schemas,
            Cat: {
              type: 'object',
              required: ['kind'],
              properties: { kind: { type: 'string' } },
            },
            Dog: {
              type: 'object',
              required: ['kind'],
              properties: { kind: { type: 'string' } },
            },
            Animal: {
              oneOf: [
                { $ref: '#/components/schemas/Cat' },
                { $ref: '#/components/schemas/Dog' },
              ],
              discriminator: { propertyName: 'kind' },
            },
          },
        },
      };

      const data = buildOpenApiCodeGenData(spec);
      const animal = data.models.find((m) => m.name === 'Animal')!;
      expect(animal.discriminator?.mapping).toEqual([
        { value: 'Cat', modelName: 'Cat' },
        { value: 'Dog', modelName: 'Dog' },
      ]);
    });

    it('should exclude hoisted inline members from implicit discriminator mapping', () => {
      const spec: Spec = {
        ...sampleSpec,
        components: {
          schemas: {
            ...sampleSpec.components.schemas,
            Dog: {
              type: 'object',
              required: ['kind'],
              properties: { kind: { type: 'string' } },
            },
            Animal: {
              oneOf: [
                { $ref: '#/components/schemas/Dog' },
                {
                  type: 'object',
                  required: ['kind'],
                  properties: { kind: { type: 'string' } },
                } as never,
              ],
              discriminator: { propertyName: 'kind' },
            },
          },
        },
      };

      const data = buildOpenApiCodeGenData(spec);
      const animal = data.models.find((m) => m.name === 'Animal')!;
      // The hoisted inline member's synthetic name (AnimalOneOf1) can never
      // appear on the wire, so only the named member is mapped.
      expect(animal.discriminator?.mapping).toEqual([
        { value: 'Dog', modelName: 'Dog' },
      ]);
    });

    it('should build base discriminator metadata for inheritance-style schemas', () => {
      const spec: Spec = {
        ...sampleSpec,
        components: {
          schemas: {
            ...sampleSpec.components.schemas,
            Base: {
              type: 'object',
              required: ['kind'],
              properties: { kind: { type: 'string' } },
              discriminator: {
                propertyName: 'kind',
                mapping: {
                  cat: '#/components/schemas/Cat',
                  dog: '#/components/schemas/Dog',
                },
              },
            },
            Cat: {
              allOf: [
                { $ref: '#/components/schemas/Base' },
                { type: 'object', properties: { meow: { type: 'boolean' } } },
              ],
            },
            Dog: {
              allOf: [
                { $ref: '#/components/schemas/Base' },
                { type: 'object', properties: { bark: { type: 'boolean' } } },
              ],
            },
          },
        },
      };

      const data = buildOpenApiCodeGenData(spec);
      const base = data.models.find((m) => m.name === 'Base')!;
      expect(base.export).toBe('interface');
      expect(base.discriminator).toEqual({
        propertyName: 'kind',
        typescriptPropertyName: 'kind',
        isBase: true,
        mapping: [
          { value: 'cat', modelName: 'Cat' },
          { value: 'dog', modelName: 'Dog' },
        ],
      });
    });

    it('should not build a base discriminator when no subtypes compose it', () => {
      const spec: Spec = {
        ...sampleSpec,
        components: {
          schemas: {
            ...sampleSpec.components.schemas,
            Lonely: {
              type: 'object',
              required: ['kind'],
              properties: { kind: { type: 'string' } },
              discriminator: { propertyName: 'kind' },
            },
          },
        },
      };

      const data = buildOpenApiCodeGenData(spec);
      const lonely = data.models.find((m) => m.name === 'Lonely')!;
      expect(lonely.discriminator).toBeUndefined();
    });

    it('should not build discriminator metadata for a non-discriminated oneOf', () => {
      const spec: Spec = {
        ...sampleSpec,
        components: {
          schemas: {
            ...sampleSpec.components.schemas,
            Cat: {
              type: 'object',
              properties: { meow: { type: 'boolean' } },
            },
            Dog: {
              type: 'object',
              properties: { bark: { type: 'boolean' } },
            },
            Animal: {
              oneOf: [
                { $ref: '#/components/schemas/Cat' },
                { $ref: '#/components/schemas/Dog' },
              ],
            },
          },
        },
      };

      const data = buildOpenApiCodeGenData(spec);
      const animal = data.models.find((m) => m.name === 'Animal')!;
      expect(animal.discriminator).toBeUndefined();
    });

    it('should throw when a response is a composite of primitives', () => {
      const spec: Spec = {
        ...sampleSpec,
        paths: {
          '/pets': {
            get: {
              operationId: 'listPets',
              responses: {
                '200': {
                  description: 'ok',
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/StringOrNumber' },
                    },
                  },
                },
              },
            },
          },
        },
        components: {
          schemas: {
            ...sampleSpec.components.schemas,
            StringOrNumber: {
              oneOf: [{ type: 'string' }, { type: 'number' }],
            },
          },
        },
      };

      expect(() => buildOpenApiCodeGenData(spec)).toThrow(
        /composite schema of primitives/,
      );
    });
  });
});
