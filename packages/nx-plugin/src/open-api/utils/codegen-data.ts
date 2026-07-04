/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import camelCase from 'lodash.camelcase';
import orderBy from 'lodash.orderby';
import trim from 'lodash.trim';
import uniqBy from 'lodash.uniqby';
import type { OpenAPIV3 } from 'openapi-types';
import {
  pascalCase,
  snakeCase,
  toClassName,
  upperFirst,
} from '../../utils/names';
import {
  toPythonName,
  toPythonType,
  toTypeScriptModelName,
  toTypeScriptName,
  toTypeScriptType,
} from './codegen-data/languages';
import {
  type ClientData,
  COLLECTION_TYPES,
  COMPOSED_SCHEMA_TYPES,
  type CodeGenData,
  type CollectionFormat,
  createModel,
  type Model,
  type ModelExport,
  type Operation,
  type PatternPropertyModel,
  PRIMITIVE_TYPES,
  type Service,
  STREAMING_CONTENT_TYPES,
  VENDOR_EXTENSIONS,
  type VendorExtensions,
} from './codegen-data/types';
import { normaliseOpenApiSpecForCodeGen } from './normalise';
import { buildClientData } from './parser';
import { isRef, resolveIfRef, splitRef } from './refs';
import type { OpenApiSchema, OpenApiSchemaOrRef, Spec } from './types';

/**
 * Return the member sub-schemas of a composite (allOf/anyOf/oneOf) schema, in
 * order, for the given composite `export` kind.
 */
const compositeMemberSchemas = (
  schema: OpenApiSchema,
  compositeExport: ModelExport,
): OpenApiSchemaOrRef[] => {
  const keyword = camelCase(compositeExport) as 'allOf' | 'anyOf' | 'oneOf';
  return (schema[keyword] as OpenApiSchemaOrRef[] | undefined) ?? [];
};

/**
 * Build the data structure used to generate code from an OpenAPI spec.
 */
export const buildOpenApiCodeGenData = (
  inSpec: Spec,
): CodeGenData => {
  // Ensure spec is ready for codegen
  const spec = normaliseOpenApiSpecForCodeGen(inSpec);

  // Build the initial data, which we will augment with additional information
  const data = buildClientData(spec);

  // Ensure the models have their links set when they are arrays/dictionaries
  ensureModelLinks(spec, data);

  // Resolve the composed models/primitives for composite schemas so the
  // templates can render them
  resolveComposedModels(data);

  const modelsByName = Object.fromEntries(data.models.map((m) => [m.name, m]));

  // Augment each service's operations with additional data
  for (const service of data.services) {
    augmentService(spec, service, modelsByName);
  }

  // All operations across all services
  const allOperations = uniqBy(
    data.services.flatMap((s) => s.operations),
    (o) => o.uniqueName,
  );

  // Add additional models for each operation's request parameters
  data.models = [
    ...data.models,
    ...allOperations.flatMap((op) =>
      buildRequestParameterModels(op, modelsByName),
    ),
  ];

  // Augment every model (including the request parameter models just added)
  // with schema-derived and language-specific data
  for (const model of data.models) {
    augmentModel(spec, model, modelsByName);
  }
  for (const model of data.models) {
    model.typescriptName = toTypeScriptModelName(model.name);
    model.typescriptType = model.typescriptName;
  }

  // Order models lexicographically by name
  data.models = orderBy(data.models, (d) => d.name);

  // Order services so default appears first, then otherwise by name
  data.services = orderBy(data.services, (s) =>
    s.name === 'Default' ? '' : s.name,
  );

  const { operationsByTag, untaggedOperations } =
    groupOperationsByTag(allOperations);

  return {
    ...data,
    operationsByTag,
    untaggedOperations,
    info: spec.info,
    allOperations,
    vendorExtensions: extractVendorExtensions(spec),
    className: toClassName(spec.info.title),
  };
};

/**
 * Augment a service and each of its operations with the data needed for code
 * generation (names, imports, result/request types, behavioural flags), and
 * compute the set of models the service (ie API client) needs to import.
 */
const augmentService = (
  spec: Spec,
  service: Service,
  modelsByName: { [name: string]: Model },
): void => {
  // Model names each operation needs to import, accumulated across operations
  const modelImports: string[] = [];

  for (const op of service.operations) {
    modelImports.push(...augmentOperation(spec, op, modelsByName));
  }

  // Lexicographical ordering of operations
  service.operations = orderBy(service.operations, (op) => op.uniqueName);

  service.modelImports = orderBy(
    uniqBy([...service.imports, ...modelImports], (x) => x),
  );

  service.className = `${service.name}Api`;
  service.nameSnakeCase = snakeCase(service.name);
};

/**
 * Augment a single operation with all the data the templates need, returning
 * the names of the models it references (for the service's import list).
 */
const augmentOperation = (
  spec: Spec,
  op: Operation,
  modelsByName: { [name: string]: Model },
): string[] => {
  const specOp = getSpecOperation(spec, op);

  assignOperationNames(op, specOp);

  // Add vendor extensions
  op.vendorExtensions = op.vendorExtensions ?? {};
  copyVendorExtensions(specOp ?? {}, op.vendorExtensions);

  const modelImports: string[] = [];
  if (specOp) {
    modelImports.push(...augmentResponses(spec, op, specOp, modelsByName));
  }
  modelImports.push(...augmentParameters(spec, op, specOp, modelsByName));

  // Add language types to response models
  op.responses.forEach(addLanguageTypes);

  // Sort responses by code
  op.responses = orderBy(op.responses, (r) => r.code);
  // Result is the lowest successful response, otherwise the 2XX or default response
  const result = op.responses.find(
    (r) => typeof r.code === 'number' && r.code >= 200 && r.code < 300,
  );
  op.result =
    result ??
    op.responses.find((r) => r.code === '2XX' || r.code === 'default');

  // Add variants of operation name (after uniqueName is set)
  op.operationIdPascalCase = pascalCase(op.uniqueName);
  op.operationIdSnakeCase = toPythonName('operation', op.uniqueName);

  // Add request type name (after operationIdPascalCase is set)
  if (op.parameters && op.parameters.length > 0) {
    const baseRequestTypeName = `${op.operationIdPascalCase}Request`;
    const hasConflict = !!spec.components?.schemas?.[baseRequestTypeName];
    // Use the OperationRequest suffix when the standard Request name clashes
    // with an existing schema, otherwise the standard Request suffix.
    op.requestTypeName = hasConflict
      ? `${op.operationIdPascalCase}OperationRequest`
      : baseRequestTypeName;
  }

  augmentOperationBehaviour(op);

  return modelImports;
};

/**
 * Set an operation's name and its deduplicated variants from the vendor
 * extensions the normaliser added.
 */
const assignOperationNames = (
  op: Operation,
  specOp: OpenAPIV3.OperationObject | undefined,
): void => {
  op.name = op.id ?? op.name;
  op.uniqueName = op.name;

  const deduplicatedOpId = specOp?.['x-aws-nx-deduplicated-op-id'] as
    | string
    | undefined;
  if (deduplicatedOpId) {
    op.uniqueName = deduplicatedOpId;
  }

  const dotNotationOpId = specOp?.['x-aws-nx-deduplicated-dot-op-id'] as
    | string
    | undefined;
  if (dotNotationOpId) {
    op.dotNotationName = dotNotationOpId;
  }
};

/**
 * Augment an operation's response models with schema-derived data, resolving
 * void responses and streaming item schemas. Returns the response model names
 * to import.
 */
const augmentResponses = (
  spec: Spec,
  op: Operation,
  specOp: OpenAPIV3.OperationObject,
  modelsByName: { [name: string]: Model },
): string[] => {
  const modelImports = op.responses
    .filter((r) => r.export === 'reference')
    .map((r) => r.type);

  for (const response of op.responses) {
    // We cannot distinguish a composite of primitives at runtime (it all comes
    // back as text), so validate this away.
    if (
      response.export === 'reference' &&
      COMPOSED_SCHEMA_TYPES.has(modelsByName[response.type]?.export)
    ) {
      const composedPrimitives = (
        modelsByName[response.type].composedPrimitives ?? []
      ).filter((p) => !['array', 'dictionary'].includes(p.export));
      if (composedPrimitives.length > 0) {
        throw new Error(
          `Operation "${op.method} ${op.path}" returns a composite schema of primitives with ${camelCase(modelsByName[response.type].export)}, which cannot be distinguished at runtime`,
        );
      }
    }

    const matchingSpecResponse = specOp.responses[`${response.code}`];
    if (!matchingSpecResponse) continue;

    const specResponse = resolveIfRef(spec, matchingSpecResponse);

    // When there's no content, the response type is 'void'
    if (!specResponse.content) {
      response.type = 'void';
      continue;
    }

    const mediaTypes = Object.keys(specResponse.content);
    response.mediaTypes = mediaTypes;

    for (const mediaType of mediaTypes) {
      const responseContent =
        specResponse.content?.[mediaType] ??
        Object.values(specResponse.content)[0];
      const responseSchema = resolveIfRef(spec, responseContent.schema);
      if (responseSchema) {
        augmentModelFromSchema(
          spec,
          response,
          responseSchema,
          modelsByName,
        );
      }
      if (
        STREAMING_CONTENT_TYPES.has(mediaType) &&
        'itemSchema' in responseContent
      ) {
        response.isJsonlStreaming = true;
        response.itemSchemaModel = buildOrReferenceModel(
          spec,
          modelsByName,
          responseContent.itemSchema as OpenApiSchemaOrRef,
        );
      }
    }
  }

  return modelImports;
};

/**
 * Augment an operation's parameter models with schema-derived data, resolving
 * request bodies and query/header collection formats. Returns the parameter
 * model names to import.
 */
const augmentParameters = (
  spec: Spec,
  op: Operation,
  specOp: OpenAPIV3.OperationObject | undefined,
  modelsByName: { [name: string]: Model },
): string[] => {
  const specParametersByName = Object.fromEntries(
    (specOp?.parameters ?? []).map((p) => {
      const param = resolveIfRef(spec, p);
      return [param.name, param];
    }),
  );

  const modelImports: string[] = [];

  for (const parameter of op.parameters) {
    if (parameter.export === 'reference') {
      modelImports.push(parameter.type);
    }

    const specParameter = specParametersByName[parameter.prop];
    const specParameterSchema = resolveIfRef(spec, specParameter?.schema);
    if (specParameterSchema) {
      augmentModelFromSchema(
        spec,
        parameter,
        specParameterSchema,
        modelsByName,
      );
    }

    if (parameter.in === 'body') {
      augmentBodyParameter(spec, parameter, specOp, modelsByName);
    } else if (
      (parameter.in === 'query' || parameter.in === 'header') &&
      specParameter
    ) {
      parameter.collectionFormat = getCollectionFormat(
        parameter.in,
        specParameter,
      );
    }

    addLanguageTypes(parameter);
  }

  return modelImports;
};

/**
 * Augment a request body parameter with its schema (the body is not in the
 * spec's `parameters`, so it is resolved from `requestBody` here) and record
 * its acceptable media types.
 */
const augmentBodyParameter = (
  spec: Spec,
  parameter: Model,
  specOp: OpenAPIV3.OperationObject | undefined,
  modelsByName: { [name: string]: Model },
): void => {
  // The request body parameter is named 'body' downstream.
  parameter.name = 'body';
  parameter.prop = 'body';

  const specBody = resolveIfRef(spec, specOp?.requestBody);
  if (!specBody) return;

  if (parameter.mediaType) {
    const bodySchema = resolveIfRef(
      spec,
      specBody.content?.[parameter.mediaType]?.schema,
    );
    if (bodySchema) {
      augmentModelFromSchema(spec, parameter, bodySchema, modelsByName);
    }
  }
  // Track all the media types that can be accepted in the request body
  parameter.mediaTypes = Object.keys(specBody.content);
};

/**
 * Translate an OpenAPI v3 parameter's style/explode into a v2-style
 * collectionFormat used when serialising array parameters.
 * @see https://spec.openapis.org/oas/v3.0.3.html#style-values
 */
const getCollectionFormat = (
  position: 'query' | 'header',
  specParameter: OpenAPIV3.ParameterObject,
): CollectionFormat => {
  const style =
    specParameter.style ?? (position === 'query' ? 'form' : 'simple');
  const explode = specParameter.explode ?? style === 'form';

  if (position === 'header') {
    return explode ? 'multi' : 'csv';
  }
  return explode
    ? 'multi'
    : ((
        {
          spaceDelimited: 'ssv',
          pipeDelimited: 'tsv',
          simple: 'csv',
          form: 'csv',
        } as const
      )[style] ?? 'multi');
};

/**
 * Build the request parameter models for an operation — one model per parameter
 * position (query/path/header/cookie/body), named e.g.
 * `FooRequestQueryParameters`. Request bodies that can be represented directly
 * (the sole parameter, or a non-clashing object reference) are inlined rather
 * than given a wrapper model, and recorded on `op.explicitRequestBodyParameter`.
 */
const buildRequestParameterModels = (
  op: Operation,
  modelsByName: { [name: string]: Model },
): Model[] => {
  if (!op.parameters || op.parameters.length === 0) {
    return [];
  }

  // Whether the request body can be represented directly, without a wrapper
  // model (ie the request will be the body itself).
  const canInlineBody = (body: Model): boolean => {
    // If the body is the only parameter, we can inline it no matter the type
    if (op.parameters.length === 1) {
      return true;
    }
    // We inline object bodies, so long as they aren't dictionaries (as
    // dictionary keys could clash with other parameters), and so long as they
    // don't have a property name that clashes with another parameter
    const hasClashingPropertyName = (
      modelsByName?.[body.type]?.properties ?? []
    ).some((prop) => op.parameters.some((param) => param.name === prop.name));
    return (
      body.export === 'reference' &&
      modelsByName?.[body.type]?.export !== 'dictionary' &&
      !hasClashingPropertyName
    );
  };

  // Group the parameters we will create models for by their position (ie 'in'
  // in the openapi spec, eg body, query, path, header, etc)
  const parametersByPosition: { [position: string]: Model[] } = {};
  for (const parameter of op.parameters) {
    if (parameter.in === 'body' && canInlineBody(parameter)) {
      continue;
    }
    parametersByPosition[parameter.in] = [
      ...(parametersByPosition[parameter.in] ?? []),
      parameter,
    ];
  }

  // Ensure that if we have an explicit (non-inlined) body parameter, it's called "body"
  const requestBodyParameter = parametersByPosition['body']?.[0];
  if (requestBodyParameter) {
    requestBodyParameter.name = 'body';
    requestBodyParameter.prop = 'body';
  }
  op.explicitRequestBodyParameter = requestBodyParameter;

  return Object.entries(parametersByPosition).map(([position, parameters]) => {
    const name = `${op.operationIdPascalCase}Request${upperFirst(position)}Parameters`;
    return createModel({
      description: op.description,
      export: 'interface',
      name,
      properties: parameters,
      type: name,
      isRequired: true,
    });
  });
};

/**
 * Augment a single model with schema-derived data (from its matching spec
 * schema, if any) and language-specific names and types.
 */
const augmentModel = (
  spec: Spec,
  model: Model,
  modelsByName: { [name: string]: Model },
): void => {
  // Add a snake_case name
  model.nameSnakeCase = toPythonName('model', model.name);

  const matchingSpecModel = spec?.components?.schemas?.[model.name];
  if (matchingSpecModel) {
    const specModel = resolveIfRef(spec, matchingSpecModel);

    augmentModelFromSchema(spec, model, specModel, modelsByName);

    model.deprecated = specModel.deprecated || false;

    // Augment properties with schema-derived data
    for (const property of model.properties) {
      const matchingSpecProperty = specModel.properties?.[property.name];
      if (matchingSpecProperty) {
        const specProperty = resolveIfRef(spec, matchingSpecProperty);
        augmentModelFromSchema(
          spec,
          property,
          specProperty,
          modelsByName,
        );
      }
    }
  }

  // Add language-specific names/types to properties
  model.properties.forEach(addLanguageTypes);
};

/**
 * Group operations by their (camelCased) tags, collecting any untagged
 * operations separately.
 */
const groupOperationsByTag = (
  allOperations: Operation[],
): {
  operationsByTag: { [tag: string]: Operation[] };
  untaggedOperations: Operation[];
} => {
  const operationsByTag: { [tag: string]: Operation[] } = {};
  const untaggedOperations: Operation[] = [];
  allOperations.forEach((op) => {
    const tags = op.tags;
    if (tags && tags.length > 0) {
      tags.map(camelCase).forEach((tag) => {
        operationsByTag[tag] = [...(operationsByTag[tag] ?? []), op];
      });
    } else {
      untaggedOperations.push(op);
    }
  });
  return { operationsByTag, untaggedOperations };
};

/**
 * Collect the top-level vendor extensions (`x-*`) declared on the spec.
 */
const extractVendorExtensions = (spec: Spec): VendorExtensions => {
  const vendorExtensions: VendorExtensions = {};
  copyVendorExtensions(spec ?? {}, vendorExtensions);
  return vendorExtensions;
};

/**
 * Build a model for a particular primitive schema.
 * Only primitives are supported since we only return one model.
 * For non-primitives, it assumes all referenced subschemas are already models
 */
const buildModelForPrimitive = (
  originalSpec: Spec,
  schema: OpenApiSchema,
): Model => {
  const targetSchemaName = '___aws_nx_plugin_openapi_tmp_schema___';

  const spec: Spec = {
    openapi: '3.1.0',
    info: { title: 'tmp', version: '1.0.0' },
    paths: {},
    components: {
      schemas: {
        ...originalSpec.components?.schemas,
        [targetSchemaName]: schema,
      },
    },
  };
  const data = buildClientData(spec);

  const model = data.models.find((m) => m.name === targetSchemaName);
  if (!model) {
    throw new Error(
      `Failed to construct model for schema ${JSON.stringify(schema)}`,
    );
  }

  ensureModelLinks(spec, data);
  augmentModelFromSchema(
    spec,
    model,
    schema,
    Object.fromEntries(data.models.map((m) => [m.name, m])),
  );

  return model;
};

const buildOrReferenceModel = (
  spec: Spec,
  modelsByName: { [name: string]: Model },
  schema: OpenApiSchemaOrRef,
): Model => {
  if (isRef(schema)) {
    const name = splitRef(schema.$ref)[2];
    return modelsByName[name];
  }
  // Non referenced schemas won't have a top-level model created as they are
  // primitives, so we build the model here
  return buildModelForPrimitive(spec, schema);
};

/**
 * Look up the spec operation object for a parsed operation.
 */
const getSpecOperation = (
  spec: Spec,
  op: Operation,
): OpenAPIV3.OperationObject | undefined =>
  (spec.paths?.[op.path] as OpenAPIV3.PathItemObject | undefined)?.[
    op.method.toLowerCase() as OpenAPIV3.HttpMethods
  ];

/**
 * Copy vendor extensions from the first parameter to the second
 */
const copyVendorExtensions = (
  object: object,
  vendorExtensions: VendorExtensions,
) => {
  Object.entries(object ?? {}).forEach(([key, value]) => {
    if (key.startsWith('x-')) {
      vendorExtensions[key] = value;
    }
  });
};

const augmentModelFromSchema = (
  spec: Spec,
  model: Model,
  schema: OpenApiSchema,
  modelsByName: { [name: string]: Model },
  visited: Set<Model> = new Set(),
) => {
  model.format = schema.format;
  model.deprecated = !!schema.deprecated;
  model.openapiType = schema.type;
  model.isEnum = !!schema.enum && schema.enum.length > 0;

  // Copy any schema vendor extensions
  model.vendorExtensions = {};
  copyVendorExtensions(schema, model.vendorExtensions);

  // A "dictionary" has only additional properties; an "interface" may mix
  // explicit and additional properties.
  if (schema.additionalProperties) {
    const additionalPropertiesModel = buildOrReferenceModel(
      spec,
      modelsByName,
      schema.additionalProperties === true ? {} : schema.additionalProperties,
    );

    if (model.export === 'dictionary') {
      // A dictionary carries a self-referential property; the rest are explicit
      const explicitProperties = model.properties.filter(
        (p) => !(p.export === 'dictionary' && p.name === model.name),
      );

      // Explicit properties make this an interface rather than a dictionary
      if (explicitProperties.length > 0 || schema.patternProperties) {
        model.export = 'interface';
        model.hasAdditionalProperties = true;
        model.additionalPropertiesModel = additionalPropertiesModel;
        model.properties = explicitProperties;
      }
    } else {
      model.hasAdditionalProperties = true;
      model.additionalPropertiesModel = additionalPropertiesModel;
    }
  }

  // Pattern properties can have different value types per pattern, so the model
  // is an interface rather than a dictionary
  if (schema.patternProperties) {
    const patternProperties = resolveIfRef(spec, schema.patternProperties);

    const patternPropertiesModels: PatternPropertyModel[] = [];

    if (model.export === 'dictionary') {
      model.export = 'interface';
    }

    for (const [pattern, patternProperty] of Object.entries(
      patternProperties,
    )) {
      const patternPropertyModel = buildOrReferenceModel(
        spec,
        modelsByName,
        patternProperty,
      );
      if (patternPropertyModel) {
        patternPropertiesModels.push({
          pattern,
          model: patternPropertyModel,
        });
      }
    }

    model.hasPatternProperties = true;
    model.patternPropertiesModels = patternPropertiesModels;
  }

  addLanguageTypes(model);

  visited.add(model);

  // Also apply to array items recursively
  if (
    model.export === 'array' &&
    model.link &&
    'items' in schema &&
    schema.items &&
    !visited.has(model.link)
  ) {
    const subSchema = resolveIfRef(spec, schema.items);
    augmentModelFromSchema(
      spec,
      model.link,
      subSchema,
      modelsByName,
      visited,
    );
  }

  // Also apply to object properties recursively
  if (
    model.export === 'dictionary' &&
    model.link &&
    'additionalProperties' in schema &&
    schema.additionalProperties &&
    !visited.has(model.link)
  ) {
    const subSchema = resolveIfRef(spec, schema.additionalProperties);
    // Additional properties can be "true" rather than a type
    if (subSchema !== true) {
      augmentModelFromSchema(
        spec,
        model.link,
        subSchema,
        modelsByName,
        visited,
      );
    }
  }

  for (const property of model.properties.filter(
    (p) => !visited.has(p) && schema.properties?.[trim(p.name, `"'`)],
  )) {
    const subSchema = resolveIfRef(
      spec,
      schema.properties![trim(property.name, `"'`)],
    );
    augmentModelFromSchema(
      spec,
      property,
      subSchema,
      modelsByName,
      visited,
    );
  }

  if (COMPOSED_SCHEMA_TYPES.has(model.export)) {
    const memberSchemas = compositeMemberSchemas(schema, model.export);
    for (let i = 0; i < model.properties.length; i++) {
      const subSchema = resolveIfRef(spec, memberSchemas[i]);
      if (subSchema) {
        augmentModelFromSchema(
          spec,
          model.properties[i],
          subSchema,
          modelsByName,
          visited,
        );
      }
    }
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
    const schema = resolveIfRef(
      spec,
      spec?.components?.schemas?.[model.name],
    ) as OpenApiSchema | undefined;
    if (schema) {
      // Object schemas should be typed as the model we will create
      if (
        schema.type === 'object' &&
        (schema.properties || schema.patternProperties)
      ) {
        model.type = model.name;
      }
      ensureModelLink(spec, modelsByName, model, schema, visited);
    }
  });

  // Ensure set for all parameters and responses
  data.services.forEach((service) => {
    service.operations.forEach((op) => {
      const specOp = getSpecOperation(spec, op);

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
          ensureModelLink(
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
            ensureModelLink(
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
            ensureModelLink(
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

const ensureModelLink = (
  spec: Spec,
  modelsByName: { [name: string]: Model },
  model: Model,
  schema: OpenApiSchema,
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
      ensureModelLink(
        spec,
        modelsByName,
        model.link,
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
      ensureModelLink(spec, modelsByName, model.link, schema.items, visited);
    }
  }

  model.properties
    .filter((p) => !visited.has(p) && schema.properties?.[trim(p.name, `"'`)])
    .forEach((property) => {
      const subSchema = resolveIfRef(
        spec,
        schema.properties![trim(property.name, `"'`)],
      );
      ensureModelLink(spec, modelsByName, property, subSchema, visited);
    });

  if (COMPOSED_SCHEMA_TYPES.has(model.export)) {
    const memberSchemas = compositeMemberSchemas(schema, model.export);
    model.properties.forEach((property, i) => {
      const subSchema = resolveIfRef(spec, memberSchemas[i]);
      if (subSchema) {
        ensureModelLink(spec, modelsByName, property, subSchema, visited);
      }
    });
  }
};

/**
 * Mutates the given data to ensure composite models (ie allOf, oneOf, anyOf) have the necessary
 * properties for representing them in generated code. Adds `composedModels` and `composedPrimitives`
 * which contain the models and primitive types that each model is composed of.
 */
const resolveComposedModels = (data: ClientData) => {
  const visited = new Set<Model>();
  data.models.forEach((model) => resolveComposedModel(data, model, visited));
};

const resolveComposedModel = (
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
    // Resolve recursively so all-of mixins include nested all-of properties
    composedModels.forEach((m) => resolveComposedModel(data, m, visited));

    // Enums serialise as primitives, so group them with the primitives
    composedPrimitives.push(
      ...composedModels.filter((m) => m.export === 'enum'),
    );
    composedModels = composedModels.filter((m) => m.export !== 'enum');

    // Composing multiple arrays of non-primitives is not distinguishable at
    // runtime, so it's validated away below.
    // TODO: honour `discriminator` to support this case.
    const isPrimitiveArray = (m: Model) => {
      if (m.link && ['array', 'dictionary'].includes(m.export)) {
        return isPrimitiveArray(m.link);
      }
      return (
        PRIMITIVE_TYPES.has(m.type) &&
        !['date', 'date-time'].includes(m.format ?? '')
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

    model.composedModels = composedModels;
    model.composedPrimitives = composedPrimitives;
  }
};

/**
 * Mutates the given model to add language specific types and names
 */
const addLanguageTypes = (model: Model) => {
  // Trim any surrounding quotes from name
  model.name = trim(model.name, `"'`);

  model.typescriptName = toTypeScriptName(model.name);
  model.typescriptType = toTypeScriptType(model);
  model.pythonName = toPythonName('property', model.name);
  model.pythonType = toPythonType(model);
  model.isPrimitive =
    PRIMITIVE_TYPES.has(model.type) &&
    !COMPOSED_SCHEMA_TYPES.has(model.export) &&
    !COLLECTION_TYPES.has(model.export);
};

/**
 * Determine whether or not an operation is a mutation
 */
const isOperationMutation = (op: Operation): boolean => {
  // Let the user override whether an operation is a query or mutation using x-mutation/x-query
  const { vendorExtensions } = op;
  if (vendorExtensions?.[VENDOR_EXTENSIONS.MUTATION]) {
    return true;
  } else if (vendorExtensions?.[VENDOR_EXTENSIONS.QUERY]) {
    return false;
  }
  // Assume a restful API and treat mutative HTTP methods as mutations
  return ['PATCH', 'POST', 'PUT', 'DELETE'].includes(op.method);
};

/**
 * Add infinite query details to the operation
 */
const augmentInfiniteQuery = (op: Operation) => {
  const { paginationDisabled, cursorPropertyName } = getCursorOptions(op);

  const cursorProperty = op.parameters.find(
    (p) => p.name === cursorPropertyName,
  );

  // An infinite query is a paginated operation that accepts the cursor parameter
  op.isInfiniteQuery = !paginationDisabled && !!cursorProperty;
  if (op.isInfiniteQuery) {
    op.infiniteQueryCursorProperty = cursorProperty;
  }
};

/**
 * Resolve the pagination cursor options from an operation's `x-cursor` vendor
 * extension. Accepted forms (object variants exist because Smithy vendor
 * extensions must be objects):
 *
 * - `'property'` / `{ inputToken: 'property' }` — the input property to page on
 * - `false` / `{ enabled: false }` — disable pagination
 */
const getCursorOptions = (op: Operation) => {
  const cursorExtension = op.vendorExtensions?.[VENDOR_EXTENSIONS.CURSOR];

  // Defaults: pagination enabled, paging on a property named 'cursor'
  let paginationDisabled = false;
  let cursorPropertyName = 'cursor';

  if (cursorExtension === false) {
    paginationDisabled = true;
  } else if (typeof cursorExtension === 'string') {
    cursorPropertyName = cursorExtension;
  } else if (cursorExtension && typeof cursorExtension === 'object') {
    const cursorOptions = cursorExtension as {
      enabled?: boolean;
      inputToken?: unknown;
    };
    if (cursorOptions.enabled === false) {
      paginationDisabled = true;
    }
    if (typeof cursorOptions.inputToken === 'string') {
      cursorPropertyName = cursorOptions.inputToken;
    }
  }

  return {
    paginationDisabled,
    cursorPropertyName,
  };
};

/**
 * Add query/mutation, streaming and infinite-query flags to an operation.
 */
const augmentOperationBehaviour = (op: Operation) => {
  const isMutation = isOperationMutation(op);
  op.isMutation = isMutation;
  op.isQuery = !isMutation;

  op.isStreaming =
    !!op.vendorExtensions?.[VENDOR_EXTENSIONS.STREAMING] ||
    op.responses.some((res) => res.isJsonlStreaming);

  // For JSON-lines streaming, the result is each streamed item, so the client
  // method returns AsyncIterableIterator<itemSchemaModel>
  const jsonlResponse = op.responses.find((res) => res.isJsonlStreaming);
  if (jsonlResponse) {
    const itemSchemaModel = jsonlResponse.itemSchemaModel;
    const result = op.result;
    if (result && itemSchemaModel) {
      result.type = itemSchemaModel.name;
      result.typescriptType = itemSchemaModel.name;
      result.export = 'reference';
    }
  }

  // Add infinite query details if applicable
  if (!isMutation) {
    augmentInfiniteQuery(op);
  }
};
