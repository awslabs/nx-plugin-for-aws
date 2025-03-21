/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import * as gen from '@hey-api/openapi-ts';
import type { Plugin } from '@hey-api/openapi-ts';
import { normaliseOpenApiSpecForCodeGen } from './normalise';
import { Spec } from './types';
import type { OpenAPIV3, OpenAPIV3_1 } from 'openapi-types';
import kebabCase from 'lodash.kebabcase';
import camelCase from 'lodash.camelcase';
import orderBy from 'lodash.orderby';
import uniqBy from 'lodash.uniqby';
import snakeCase from 'lodash.snakecase';
import trim from 'lodash.trim';
import { resolveIfRef, isRef, splitRef } from './refs';
import { pascalCase, toClassName, upperFirst } from '../../utils/names';
import {
  toPythonName,
  toTypeScriptType,
  toPythonType,
  toTypeScriptName,
} from './codegen-data/languages';
import {
  CodeGenData,
  ClientData,
  Model,
  flattenModelLink,
  COLLECTION_TYPES,
  COMPOSED_SCHEMA_TYPES,
  PRIMITIVE_TYPES,
  Operation,
} from './codegen-data/types';

/**
 * Builds a data structure from an OpenAPI spec which can be used to generate code
 */
export const buildOpenApiCodeGenData = async (
  inSpec: Spec,
): Promise<CodeGenData> => {
  // Ensure spec is ready for codegen
  const spec = normaliseOpenApiSpecForCodeGen(inSpec);

  // Build the initial data, which we will augment with additional information
  const data = await buildInitialCodeGenData(spec);

  // Ensure the models have their links set when they are arrays/dictionaries
  ensureModelLinks(spec, data);

  // Mutate the models with enough data to render composite models in the templates
  ensureCompositeModels(data);

  const modelsByName = Object.fromEntries(data.models.map((m) => [m.name, m]));

  // Augment operations with additional data
  data.services.forEach((service) => {
    // Keep track of the request and response models we need the service (ie api client) to import
    const requestModelImports: string[] = [];
    const responseModelImports: string[] = [];

    service.operations.forEach((op) => {
      // Extract the operation back from the openapi spec
      const specOp = (spec as any)?.paths?.[op.path]?.[
        op.method.toLowerCase()
      ] as OpenAPIV3.OperationObject | undefined;

      op.name = op.id ?? op.name;
      (op as any).uniqueName = op.name;
      if (specOp['x-aws-nx-deduplicated-op-id']) {
        (op as any).uniqueName = specOp['x-aws-nx-deduplicated-op-id'];
      }

      // Add vendor extensions
      (op as any).vendorExtensions = (op as any).vendorExtensions ?? {};
      copyVendorExtensions(specOp ?? {}, (op as any).vendorExtensions);

      if (specOp) {
        // Add all response models to the response model imports
        responseModelImports.push(
          ...op.responses
            .filter((r) => r.export === 'reference')
            .map((r) => r.type),
        );

        op.responses.forEach((response) => {
          // Validate that the response is not a composite schema of primitives since we cannot determine what
          // the type of the response is (it all comes back as text!)
          if (
            response.export === 'reference' &&
            COMPOSED_SCHEMA_TYPES.has(modelsByName[response.type]?.export)
          ) {
            const composedPrimitives = (
              modelsByName[response.type] as any
            ).composedPrimitives.filter(
              (p) => !['array', 'dictionary'].includes(p.export),
            );
            if (composedPrimitives.length > 0) {
              throw new Error(
                `Operation "${op.method} ${op.path}" returns a composite schema of primitives with ${camelCase(modelsByName[response.type].export)}, which cannot be distinguished at runtime`,
              );
            }
          }

          const matchingSpecResponse = specOp.responses[`${response.code}`];

          // @hey-api/openapi-ts does not distinguish between returning an "any" or returning "void"
          // We distinguish this by looking back at each response in the spec, and checking whether it
          // has content
          if (matchingSpecResponse) {
            // Resolve the ref if necessary
            const specResponse = resolveIfRef(spec, matchingSpecResponse);

            // When there's no content, we set the type to 'void'
            if (!specResponse.content) {
              response.type = 'void';
            } else {
              // Add the response media types
              const mediaTypes = Object.keys(specResponse.content);
              (response as any).mediaTypes = mediaTypes;

              mediaTypes.forEach((mediaType) => {
                const responseContent =
                  specResponse.content?.[mediaType] ??
                  Object.values(specResponse.content)[0];
                const responseSchema = resolveIfRef(
                  spec,
                  responseContent.schema,
                );
                if (responseSchema) {
                  mutateWithOpenapiSchemaProperties(
                    spec,
                    response,
                    responseSchema,
                  );
                }
              });
            }
          }
        });
      }

      const specParametersByName = Object.fromEntries(
        (specOp?.parameters ?? []).map((p) => {
          const param = resolveIfRef(spec, p);
          return [param.name, param];
        }),
      );

      // Loop through the parameters
      op.parameters.forEach((parameter) => {
        // Add the request model import
        if (parameter.export === 'reference') {
          requestModelImports.push(parameter.type);
        }

        const specParameter = specParametersByName[parameter.prop];
        const specParameterSchema = resolveIfRef(spec, specParameter?.schema);

        if (specParameterSchema) {
          mutateWithOpenapiSchemaProperties(
            spec,
            parameter,
            specParameterSchema,
          );
        }

        if (parameter.in === 'body') {
          // Parameter name for the body is 'body'
          parameter.name = 'body';
          parameter.prop = 'body';

          // The request body is not in the "parameters" section of the openapi spec so we won't have added the schema
          // properties above. Find it here.
          const specBody = resolveIfRef(spec, specOp?.requestBody);
          if (specBody) {
            if (parameter.mediaType) {
              const bodySchema = resolveIfRef(
                spec,
                specBody.content?.[parameter.mediaType]?.schema,
              );
              if (bodySchema) {
                mutateWithOpenapiSchemaProperties(spec, parameter, bodySchema);
              }
            }
            // Track all the media types that can be accepted in the request body
            (parameter as any).mediaTypes = Object.keys(specBody.content);
          }
        } else if (
          ['query', 'header'].includes(parameter.in) &&
          specParameter
        ) {
          // Translate style/explode to OpenAPI v2 style collectionFormat
          // https://spec.openapis.org/oas/v3.0.3.html#style-values
          const style =
            specParameter.style ??
            (parameter.in === 'query' ? 'form' : 'simple');
          const explode = specParameter.explode ?? style === 'form';

          if (parameter.in === 'query') {
            (parameter as any).collectionFormat = explode
              ? 'multi'
              : ({
                  spaceDelimited: 'ssv',
                  pipeDelimited: 'tsv',
                  simple: 'csv',
                  form: 'csv',
                }[style] ?? 'multi');
          } else {
            // parameter.in === "header"
            (parameter as any).collectionFormat = explode ? 'multi' : 'csv';
          }
        }

        mutateModelWithAdditionalTypes(parameter);
      });

      // Add language types to response models
      (op.responses ?? []).forEach(mutateModelWithAdditionalTypes);

      // Sort responses by code
      op.responses = orderBy(op.responses, (r) => r.code);
      // Result is the lowest successful response, otherwise is the 2XX or default response
      const result = op.responses.find(
        (r) => typeof r.code === 'number' && r.code >= 200 && r.code < 300,
      );
      (op as any).result =
        result ??
        op.responses.find((r) => r.code === '2XX' || r.code === 'default');

      // Add variants of operation name
      (op as any).operationIdPascalCase = pascalCase((op as any).uniqueName);
      (op as any).operationIdKebabCase = kebabCase((op as any).uniqueName);
      (op as any).operationIdSnakeCase = toPythonName(
        'operation',
        (op as any).uniqueName,
      );
    });

    // Lexicographical ordering of operations
    service.operations = orderBy(
      service.operations,
      (op) => (op as any).uniqueName,
    );

    // Add the models to import
    (service as any).modelImports = orderBy(
      uniqBy(
        [...service.imports, ...requestModelImports, ...responseModelImports],
        (x) => x,
      ),
    );

    // Add the service class name
    (service as any).className = `${service.name}Api`;
    (service as any).classNameSnakeCase = snakeCase((service as any).className);
    (service as any).nameSnakeCase = snakeCase(service.name);
  });

  // All operations across all services
  const allOperations = uniqBy(
    data.services.flatMap((s) => s.operations),
    (o) => (o as any).uniqueName,
  );

  // Add additional models for operation parameters
  data.models = [
    ...data.models,
    ...allOperations.flatMap((op: Operation): Model[] => {
      if (op.parameters && op.parameters.length > 0) {
        // Build a collection of request parameter models to create based on their position (ie 'in' in the openapi spec, eg body, query, path, header, etc)
        const parametersByPosition: { [position: string]: Model[] } = {};

        op.parameters
          .filter(
            // We filter out (return false for) request bodies which we "inline" - ie we don't create a property which points to the body, the request will only be the body itself
            (p) => {
              // Always create models for non-body parameters
              if (p.in !== 'body') {
                return true;
              }

              // If the body is the only parameter, we can inline it no matter the type
              if (op.parameters.length === 1) {
                return false;
              }

              // We inline object bodies, so long as they aren't dictionaries (as dictionary keys could clash with other parameters),
              // and so long as they don't have a property name that clashes with another parameter
              const hasClashingPropertyName = (
                modelsByName?.[p.type]?.properties ?? []
              ).some((prop) =>
                op.parameters.some((param) => param.name === prop.name),
              );
              if (
                p.export === 'reference' &&
                modelsByName?.[p.type]?.export !== 'dictionary' &&
                !hasClashingPropertyName
              ) {
                return false;
              }

              // Don't inline anything else
              return true;
            },
          )
          .forEach((parameter) => {
            parametersByPosition[parameter.in] = [
              ...(parametersByPosition[parameter.in] ?? []),
              parameter,
            ];
          });

        // Ensure that if we have an explicit body parameter, it's called "body"
        const requestBodyParameter = parametersByPosition['body']?.[0];
        if (requestBodyParameter) {
          requestBodyParameter.name = 'body';
          (requestBodyParameter as any).prop = 'body';
        }

        (op as any).explicitRequestBodyParameter = requestBodyParameter;

        return Object.entries(parametersByPosition).map(
          ([position, parameters]) => {
            const name = `${(op as any).operationIdPascalCase}Request${upperFirst(position)}Parameters`;
            return {
              $refs: [],
              base: name,
              description: op.description,
              enum: null,
              enums: null,
              export: 'interface',
              imports: [],
              in: '',
              link: undefined,
              name,
              properties: parameters,
              template: '',
              type: name,
              isDefinition: false,
              isNullable: false,
              isReadOnly: false,
              isRequired: true,
            };
          },
        );
      }
      return [] as Model[];
    }),
  ];

  // Augment models with additional data
  data.models.forEach((model) => {
    // Add a snake_case name
    (model as any).nameSnakeCase = toPythonName('model', model.name);

    const matchingSpecModel = spec?.components?.schemas?.[model.name];

    if (matchingSpecModel) {
      const specModel = resolveIfRef(spec, matchingSpecModel);

      mutateWithOpenapiSchemaProperties(spec, model, specModel);

      // Add unique imports
      (model as any).uniqueImports = orderBy(
        uniqBy(
          [
            ...model.imports,
            // Include property imports, if any
            ...model.properties
              .filter((p) => p.export === 'reference')
              .map((p) => p.type),
          ],
          (x) => x,
        ),
      ).filter((modelImport) => modelImport !== model.name); // Filter out self for recursive model references

      // Add deprecated flag if present
      (model as any).deprecated = specModel.deprecated || false;

      // If the model has "additionalProperties" there should be a "dictionary" property
      if (specModel.additionalProperties) {
        (model as any).additionalPropertiesProperty = model.properties.find(
          (p) => !p.name && p.export === 'dictionary',
        );
      }

      // Augment properties with additional data
      model.properties.forEach((property) => {
        const matchingSpecProperty = specModel.properties?.[property.name];

        if (matchingSpecProperty) {
          const specProperty = resolveIfRef(spec, matchingSpecProperty);
          mutateWithOpenapiSchemaProperties(spec, property, specProperty);
        }
      });
    }

    // Augment properties with additional data
    model.properties.forEach((property) => {
      // Add language-specific names/types
      mutateModelWithAdditionalTypes(property);
    });
  });

  // Order models lexicographically by name
  data.models = orderBy(data.models, (d) => d.name);

  // Order services so default appears first, then otherwise by name
  data.services = orderBy(data.services, (s) =>
    s.name === 'Default' ? '' : s.name,
  );

  // All operations by tags
  const operationsByTag: { [tag: string]: Operation[] } = {};
  const untaggedOperations: Operation[] = [];
  allOperations.forEach((op) => {
    const tags = (op as any).tags;
    if (tags && tags.length > 0) {
      tags.map(camelCase).forEach((tag: string) => {
        operationsByTag[tag] = [...(operationsByTag[tag] ?? []), op];
      });
    } else {
      untaggedOperations.push(op);
    }
  });

  // Add top level vendor extensions
  const vendorExtensions: { [key: string]: any } = {};
  copyVendorExtensions(spec ?? {}, vendorExtensions);

  return {
    ...data,
    operationsByTag,
    untaggedOperations,
    info: spec.info,
    allOperations,
    vendorExtensions,
    className: toClassName(spec.info.title),
  };
};

const buildInitialCodeGenData = async (spec: Spec): Promise<ClientData> => {
  let data: ClientData;

  // We create a plugin which will capture the client data
  const plugin: Plugin.DefineConfig<{ name: string }> = () => ({
    name: 'plugin',
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    _handler: () => {},
    _handlerLegacy: ({ client }) => {
      data = client;
    },
  });

  // Use @hey-api/openapi-ts to build the initial data structure that we'll generate clients from
  await gen.createClient({
    experimentalParser: false,
    input: {
      path: spec,
    },
    output: 'unused',
    plugins: [plugin()],
    dryRun: true,
    logs: { level: 'silent' },
  });

  if (!data) {
    // If this happens it indicates an update to @hey-api/openapi-ts which has removed the legacy parser
    throw new Error('Failed to build code generation data');
  }

  return data;
};

/**
 * Copy vendor extensions from the first parameter to the second
 */
const copyVendorExtensions = (
  object: object,
  vendorExtensions: { [key: string]: any },
) => {
  Object.entries(object ?? {}).forEach(([key, value]) => {
    if (key.startsWith('x-')) {
      vendorExtensions[key] = value;
    }
  });
};

const mutateWithOpenapiSchemaProperties = (
  spec: Spec,
  model: Model,
  schema: OpenAPIV3.SchemaObject | OpenAPIV3_1.SchemaObject,
  visited: Set<Model> = new Set(),
) => {
  (model as any).format = schema.format;
  (model as any).isInteger = schema.type === 'integer';
  (model as any).isShort = schema.format === 'int32';
  (model as any).isLong = schema.format === 'int64';
  (model as any).deprecated = !!schema.deprecated;
  (model as any).openapiType = schema.type;
  (model as any).isNotSchema = !!schema.not;
  (model as any).isEnum = !!schema.enum && schema.enum.length > 0;

  // Copy any schema vendor extensions
  (model as any).vendorExtensions = {};
  copyVendorExtensions(schema, (model as any).vendorExtensions);

  // Use our added vendor extension
  (model as any).isHoisted = !!(model as any).vendorExtensions?.[
    'x-aws-nx-hoisted'
  ];

  mutateModelWithAdditionalTypes(model);

  visited.add(model);

  const modelLink = flattenModelLink(model.link);

  // Also apply to array items recursively
  if (
    model.export === 'array' &&
    modelLink &&
    'items' in schema &&
    schema.items &&
    !visited.has(modelLink)
  ) {
    const subSchema = resolveIfRef(spec, schema.items);
    mutateWithOpenapiSchemaProperties(spec, modelLink, subSchema, visited);
  }

  // Also apply to object properties recursively
  if (
    model.export === 'dictionary' &&
    model.link &&
    'additionalProperties' in schema &&
    schema.additionalProperties &&
    !visited.has(modelLink)
  ) {
    const subSchema = resolveIfRef(spec, schema.additionalProperties);
    // Additional properties can be "true" rather than a type
    if (subSchema !== true) {
      mutateWithOpenapiSchemaProperties(spec, modelLink, subSchema, visited);
    }
  }
  model.properties
    .filter((p) => !visited.has(p) && schema.properties?.[trim(p.name, `"'`)])
    .forEach((property) => {
      const subSchema = resolveIfRef(
        spec,
        schema.properties![trim(property.name, `"'`)],
      );
      mutateWithOpenapiSchemaProperties(spec, property, subSchema, visited);
    });

  if (COMPOSED_SCHEMA_TYPES.has(model.export)) {
    model.properties.forEach((property, i) => {
      const subSchema = resolveIfRef(
        spec,
        (schema as any)[camelCase(model.export)]?.[i],
      );
      if (subSchema) {
        mutateWithOpenapiSchemaProperties(spec, property, subSchema, visited);
      }
    });
  }
};

/**
 * Ensure that the "link" property of all dictionary/array models and properties are set recursively
 */
const ensureModelLinks = (spec: Spec, data: ClientData) => {
  const modelsByName = Object.fromEntries(data.models.map((m) => [m.name, m]));
  const visited = new Set<Model>();

  // Ensure set for all models
  data.models.forEach((model) => {
    const schema = resolveIfRef(spec, spec?.components?.schemas?.[model.name]);
    if (schema) {
      // Object schemas should be typed as the model we will create
      if (schema.type === 'object' && schema.properties) {
        model.type = model.name;
      }
      _ensureModelLinks(spec, modelsByName, model, schema, visited);
    }
  });

  // Ensure set for all parameters and responses
  data.services.forEach((service) => {
    service.operations.forEach((op) => {
      const specOp = (spec as any)?.paths?.[op.path]?.[
        op.method.toLowerCase()
      ] as OpenAPIV3.OperationObject | undefined;

      const specParametersByName = Object.fromEntries(
        (specOp?.parameters ?? []).map((p) => {
          const param = resolveIfRef(spec, p);
          return [param.name, param];
        }),
      );

      op.parameters.forEach((parameter) => {
        const specParameter = specParametersByName[parameter.prop];
        const specParameterSchema = resolveIfRef(spec, specParameter?.schema);

        if (specParameterSchema) {
          _ensureModelLinks(
            spec,
            modelsByName,
            parameter,
            specParameterSchema,
            visited,
          );
        } else if (parameter.in === 'body') {
          // Body is not in the "parameters" section of the OpenAPI spec so we handle it in an explicit case here
          const specBody = resolveIfRef(spec, specOp?.requestBody);
          const specBodySchema = resolveIfRef(
            spec,
            specBody?.content?.[parameter.mediaType]?.schema,
          );

          if (specBodySchema) {
            _ensureModelLinks(
              spec,
              modelsByName,
              parameter,
              specBodySchema,
              visited,
            );
          }
        }
      });

      op.responses.forEach((response) => {
        const specResponse = resolveIfRef(
          spec,
          specOp?.responses?.[response.code],
        );
        const mediaTypes = Object.keys(specResponse?.content ?? {});
        mediaTypes.forEach((mediaType) => {
          const responseSchema = resolveIfRef(
            spec,
            specResponse?.content?.[mediaType]?.schema,
          );
          if (responseSchema) {
            _ensureModelLinks(
              spec,
              modelsByName,
              response,
              responseSchema,
              visited,
            );
          }
        });
      });
    });
  });
};

const _ensureModelLinks = (
  spec: Spec,
  modelsByName: { [name: string]: Model },
  model: Model,
  schema: OpenAPIV3.SchemaObject | OpenAPIV3_1.SchemaObject,
  visited: Set<Model>,
) => {
  if (visited.has(model)) {
    return;
  }

  visited.add(model);

  if (
    model.export === 'dictionary' &&
    'additionalProperties' in schema &&
    schema.additionalProperties
  ) {
    if (isRef(schema.additionalProperties)) {
      const name = splitRef(schema.additionalProperties.$ref)[2];
      if (modelsByName[name] && !model.link) {
        model.link = modelsByName[name];
      }
    } else if (model.link && typeof schema.additionalProperties !== 'boolean') {
      _ensureModelLinks(
        spec,
        modelsByName,
        flattenModelLink(model.link),
        schema.additionalProperties,
        visited,
      );
    }
  } else if (model.export === 'array' && 'items' in schema && schema.items) {
    if (isRef(schema.items)) {
      const name = splitRef(schema.items.$ref)[2];
      if (modelsByName[name] && !model.link) {
        model.link = modelsByName[name];
      }
    } else if (model.link) {
      _ensureModelLinks(
        spec,
        modelsByName,
        flattenModelLink(model.link),
        schema.items,
        visited,
      );
    }
  }

  model.properties
    .filter((p) => !visited.has(p) && schema.properties?.[trim(p.name, `"'`)])
    .forEach((property) => {
      const subSchema = resolveIfRef(
        spec,
        schema.properties![trim(property.name, `"'`)],
      );
      _ensureModelLinks(spec, modelsByName, property, subSchema, visited);
    });

  if (COMPOSED_SCHEMA_TYPES.has(model.export)) {
    model.properties.forEach((property, i) => {
      const subSchema = resolveIfRef(
        spec,
        (schema as any)[camelCase(model.export)]?.[i],
      );
      if (subSchema) {
        _ensureModelLinks(spec, modelsByName, property, subSchema, visited);
      }
    });
  }
};

/**
 * Mutates the given data to ensure composite models (ie allOf, oneOf, anyOf) have the necessary
 * properties for representing them in generated code. Adds `composedModels` and `composedPrimitives`
 * which contain the models and primitive types that each model is composed of.
 */
const ensureCompositeModels = (data: ClientData) => {
  const visited = new Set<Model>();
  data.models.forEach((model) =>
    mutateModelWithCompositeProperties(data, model, visited),
  );
};

const mutateModelWithCompositeProperties = (
  data: ClientData,
  model: Model,
  visited: Set<Model>,
) => {
  if (COMPOSED_SCHEMA_TYPES.has(model.export) && !visited.has(model)) {
    visited.add(model);

    // Find the models/primitives which this is composed from
    const composedModelReferences = model.properties.filter(
      (p) => !p.name && p.export === 'reference',
    );
    const composedPrimitives = model.properties.filter(
      (p) => !p.name && p.export !== 'reference',
    );

    const modelsByName = Object.fromEntries(
      data.models.map((m) => [m.name, m]),
    );
    let composedModels = composedModelReferences.flatMap((r) =>
      modelsByName[r.type] ? [modelsByName[r.type]] : [],
    );
    // Recursively resolve composed properties of properties, to ensure mixins for all-of include all recursive all-of properties
    composedModels.forEach((m) =>
      mutateModelWithCompositeProperties(data, m, visited),
    );

    // Enums are models, however they are serialised as primitives and so should be moved to the primitives list
    composedPrimitives.push(
      ...composedModels.filter((m) => m.export === 'enum'),
    );
    composedModels = composedModels.filter((m) => m.export !== 'enum');

    // When multiple arrays of non-primitives are composed using allOf/oneOf/anyOf, it's not possible to distinguish at runtime which
    // type it is, and so we validate this away.
    // TODO: consider honouring more advanced OpenAPI spec features like "discriminators" which can help for this case, but in practice
    // users are unlikely to model their API this way
    const isPrimitiveArray = (m: Model) => {
      if (m.link && ['array', 'dictionary'].includes(m.export)) {
        return isPrimitiveArray(flattenModelLink(m.link));
      }
      return (
        PRIMITIVE_TYPES.has(m.type) && !['date', 'date-time'].includes(m.format)
      );
    };
    const arrayComposedModels = composedPrimitives.filter(
      (m) => m.export === 'array' && !isPrimitiveArray(m),
    );
    if (arrayComposedModels.length > 1) {
      throw new Error(
        `Schema "${model.name}" defines ${camelCase(model.export)} with multiple array types which cannot be distinguished at runtime.`,
      );
    }

    // For all-of models, we include all composed model properties.
    if (model.export === 'all-of') {
      if (composedPrimitives.length > 0) {
        throw new Error(
          `Schema "${model.name}" defines allOf with non-object types. allOf may only compose object types in the OpenAPI specification.`,
        );
      }
    }

    (model as any).composedModels = composedModels;
    (model as any).composedPrimitives = composedPrimitives;
  }
};

/**
 * Mutates the given model to add language specific types and names
 */
const mutateModelWithAdditionalTypes = (model: Model) => {
  // Trim any surrounding quotes from name
  model.name = trim(model.name, `"'`);

  (model as any).typescriptName = toTypeScriptName(model.name);
  (model as any).typescriptType = toTypeScriptType(model);
  (model as any).pythonName = toPythonName('property', model.name);
  (model as any).pythonType = toPythonType(model);
  (model as any).isPrimitive =
    PRIMITIVE_TYPES.has(model.type) &&
    !COMPOSED_SCHEMA_TYPES.has(model.export) &&
    !COLLECTION_TYPES.has(model.export);
};
