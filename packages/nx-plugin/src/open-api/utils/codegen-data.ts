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
  DEFAULT_SERVICE_NAME,
  indexModelsByName,
  type Model,
  type ModelExport,
  type ModelsByName,
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
  const spec = normaliseOpenApiSpecForCodeGen(inSpec);
  const data = buildClientData(spec);

  // Set array/dictionary links and composite members before augmentation reads
  // them.
  ensureModelLinks(spec, data);
  resolveComposedModels(data);

  const modelsByName = indexModelsByName(data.models);

  for (const service of data.services) {
    augmentService(spec, service, modelsByName);
  }

  const allOperations = uniqBy(
    data.services.flatMap((s) => s.operations),
    (o) => o.uniqueName,
  );

  // A model per operation request parameter position (query/path/body/...).
  data.models = [
    ...data.models,
    ...allOperations.flatMap((op) =>
      buildRequestParameterModels(op, modelsByName),
    ),
  ];

  for (const model of data.models) {
    augmentModel(spec, model, modelsByName);
  }
  for (const model of data.models) {
    model.typescriptName = toTypeScriptModelName(model.name);
    model.typescriptType = model.typescriptName;
  }

  data.models = orderBy(data.models, (d) => d.name);
  // Default service first, then by name.
  data.services = orderBy(data.services, (s) =>
    s.name === DEFAULT_SERVICE_NAME ? '' : s.name,
  );

  const { operationsByTag, untaggedOperations } =
    groupOperationsByTag(allOperations);

  return {
    ...data,
    operationsByTag,
    untaggedOperations,
    info: spec.info,
    allOperations,
    vendorExtensions: vendorExtensionsOf(spec),
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
  modelsByName: ModelsByName,
): void => {
  const modelImports = service.operations.flatMap((op) =>
    augmentOperation(spec, op, modelsByName),
  );

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
  modelsByName: ModelsByName,
): string[] => {
  const specOp = getSpecOperation(spec, op);

  assignOperationNames(op, specOp);

  op.vendorExtensions = vendorExtensionsOf(specOp);

  const modelImports = [
    ...(specOp ? augmentResponses(spec, op, specOp, modelsByName) : []),
    ...augmentParameters(spec, op, specOp, modelsByName),
  ];

  op.responses.forEach(addLanguageTypes);
  op.responses = orderBy(op.responses, (r) => r.code);

  // Result is the lowest successful response, otherwise the 2XX or default.
  op.result =
    op.responses.find(
      (r) => typeof r.code === 'number' && r.code >= 200 && r.code < 300,
    ) ?? op.responses.find((r) => r.code === '2XX' || r.code === 'default');

  op.operationIdPascalCase = pascalCase(op.uniqueName);
  op.operationIdSnakeCase = toPythonName('operation', op.uniqueName);

  if (op.parameters.length > 0) {
    const baseRequestTypeName = `${op.operationIdPascalCase}Request`;
    // Use the OperationRequest suffix when the standard Request name clashes
    // with an existing schema.
    op.requestTypeName = spec.components?.schemas?.[baseRequestTypeName]
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
  const deduplicatedOpId = specOp?.['x-aws-nx-deduplicated-op-id'] as
    | string
    | undefined;
  const dotNotationOpId = specOp?.['x-aws-nx-deduplicated-dot-op-id'] as
    | string
    | undefined;

  op.name = op.id ?? op.name;
  op.uniqueName = deduplicatedOpId ?? op.name;
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
  modelsByName: ModelsByName,
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
      ).filter((p) => !COLLECTION_TYPES.has(p.export));
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
        augmentModelFromSchema(spec, response, responseSchema, modelsByName);
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
  modelsByName: ModelsByName,
): string[] => {
  const specParametersByName = getSpecParametersByName(spec, specOp);

  const modelImports: string[] = [];

  for (const parameter of op.parameters) {
    if (parameter.export === 'reference') {
      modelImports.push(parameter.type);
    }

    const specParameter = specParametersByName[parameter.prop];
    const specParameterSchema = resolveIfRef(spec, specParameter?.schema);
    if (specParameterSchema) {
      augmentModelFromSchema(spec, parameter, specParameterSchema, modelsByName);
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
  modelsByName: ModelsByName,
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
  modelsByName: ModelsByName,
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

  // Group parameters by their position (`in`: query/path/header/cookie/body),
  // dropping any body that can be inlined.
  const parametersByPosition = op.parameters
    .filter((p) => !(p.in === 'body' && canInlineBody(p)))
    .reduce<{ [position: string]: Model[] }>(
      (acc, p) => ({ ...acc, [p.in]: [...(acc[p.in] ?? []), p] }),
      {},
    );

  // An explicit (non-inlined) body parameter is named "body".
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
  modelsByName: ModelsByName,
): void => {
  model.nameSnakeCase = toPythonName('model', model.name);

  const matchingSpecModel = spec?.components?.schemas?.[model.name];
  if (matchingSpecModel) {
    const specModel = resolveIfRef(spec, matchingSpecModel);

    augmentModelFromSchema(spec, model, specModel, modelsByName);

    for (const property of model.properties) {
      const matchingSpecProperty = specModel.properties?.[property.name];
      if (matchingSpecProperty) {
        const specProperty = resolveIfRef(spec, matchingSpecProperty);
        augmentModelFromSchema(spec, property, specProperty, modelsByName);
      }
    }
  }

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
  const isTagged = (op: Operation): boolean => !!op.tags && op.tags.length > 0;

  const operationsByTag = allOperations
    .filter(isTagged)
    .flatMap((op) => op.tags!.map((tag) => [camelCase(tag), op] as const))
    .reduce<{ [tag: string]: Operation[] }>(
      (acc, [tag, op]) => ({ ...acc, [tag]: [...(acc[tag] ?? []), op] }),
      {},
    );

  return {
    operationsByTag,
    untaggedOperations: allOperations.filter((op) => !isTagged(op)),
  };
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
  augmentModelFromSchema(spec, model, schema, indexModelsByName(data.models));

  return model;
};

const buildOrReferenceModel = (
  spec: Spec,
  modelsByName: ModelsByName,
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
 * An operation's resolved parameters indexed by name.
 */
const getSpecParametersByName = (
  spec: Spec,
  specOp: OpenAPIV3.OperationObject | undefined,
): { [name: string]: OpenAPIV3.ParameterObject } =>
  Object.fromEntries(
    (specOp?.parameters ?? []).map((p) => {
      const param = resolveIfRef(spec, p);
      return [param.name, param];
    }),
  );

/**
 * The `x-*` vendor extensions declared on an object.
 */
const vendorExtensionsOf = (object: object | undefined): VendorExtensions =>
  Object.fromEntries(
    Object.entries(object ?? {}).filter(([key]) => key.startsWith('x-')),
  );

const augmentModelFromSchema = (
  spec: Spec,
  model: Model,
  schema: OpenApiSchema,
  modelsByName: ModelsByName,
  visited: Set<Model> = new Set(),
) => {
  model.format = schema.format;
  model.deprecated = !!schema.deprecated;
  model.openapiType = schema.type;
  model.isEnum = !!schema.enum && schema.enum.length > 0;
  model.vendorExtensions = vendorExtensionsOf(schema);

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
  // is an interface rather than a dictionary.
  if (schema.patternProperties) {
    const patternProperties = resolveIfRef(spec, schema.patternProperties);

    if (model.export === 'dictionary') {
      model.export = 'interface';
    }

    model.hasPatternProperties = true;
    model.patternPropertiesModels = Object.entries(patternProperties)
      .map(([pattern, patternProperty]) => ({
        pattern,
        model: buildOrReferenceModel(spec, modelsByName, patternProperty),
      }))
      .filter((entry): entry is PatternPropertyModel => !!entry.model);
  }

  addLanguageTypes(model);

  visited.add(model);

  const recurse = (target: Model, subSchema: OpenApiSchema): void =>
    augmentModelFromSchema(spec, target, subSchema, modelsByName, visited);

  // Array element type.
  if (
    model.export === 'array' &&
    model.link &&
    'items' in schema &&
    schema.items &&
    !visited.has(model.link)
  ) {
    recurse(model.link, resolveIfRef(spec, schema.items));
  }

  // Dictionary value type (additionalProperties may be `true` rather than a
  // schema).
  if (
    model.export === 'dictionary' &&
    model.link &&
    'additionalProperties' in schema &&
    schema.additionalProperties &&
    !visited.has(model.link)
  ) {
    const subSchema = resolveIfRef(spec, schema.additionalProperties);
    if (subSchema !== true) {
      recurse(model.link, subSchema);
    }
  }

  model.properties
    .filter((p) => !visited.has(p) && schema.properties?.[trim(p.name, `"'`)])
    .forEach((property) =>
      recurse(
        property,
        resolveIfRef(spec, schema.properties![trim(property.name, `"'`)]),
      ),
    );

  if (COMPOSED_SCHEMA_TYPES.has(model.export)) {
    const memberSchemas = compositeMemberSchemas(schema, model.export);
    model.properties.forEach((property, i) => {
      const subSchema = resolveIfRef(spec, memberSchemas[i]);
      if (subSchema) {
        recurse(property, subSchema);
      }
    });
  }
};

/**
 * Ensure that the "link" property of all dictionary/array models and properties are set recursively
 */
const ensureModelLinks = (spec: Spec, data: ClientData) => {
  const modelsByName = indexModelsByName(data.models);
  const visited = new Set<Model>();

  // Ensure set for all models
  data.models.forEach((model) => {
    const schema = resolveIfRef<OpenApiSchema | undefined>(
      spec,
      spec?.components?.schemas?.[model.name],
    );
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
      const specParametersByName = getSpecParametersByName(spec, specOp);

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
  modelsByName: ModelsByName,
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
 * Populate `composedModels` and `composedPrimitives` on each composite model
 * (allOf/anyOf/oneOf) with the models and primitive types it is composed of.
 */
const resolveComposedModels = (data: ClientData) => {
  const modelsByName = indexModelsByName(data.models);
  const visited = new Set<Model>();
  data.models.forEach((model) =>
    resolveComposedModel(modelsByName, model, visited),
  );
};

const resolveComposedModel = (
  modelsByName: ModelsByName,
  model: Model,
  visited: Set<Model>,
) => {
  if (!COMPOSED_SCHEMA_TYPES.has(model.export) || visited.has(model)) {
    return;
  }
  visited.add(model);

  const members = model.properties.filter((p) => !p.name);
  const referenced = members
    .filter((p) => p.export === 'reference')
    .flatMap((r) => (modelsByName[r.type] ? [modelsByName[r.type]] : []));

  // Resolve recursively so all-of mixins include nested all-of properties
  referenced.forEach((m) => resolveComposedModel(modelsByName, m, visited));

  // Enums serialise as primitives, so group them with the primitives
  const composedModels = referenced.filter((m) => m.export !== 'enum');
  const composedPrimitives = [
    ...members.filter((p) => p.export !== 'reference'),
    ...referenced.filter((m) => m.export === 'enum'),
  ];

  // Composing multiple arrays of non-primitives is not distinguishable at
  // runtime, so it's validated away.
  // TODO: honour `discriminator` to support this case.
  const isPrimitiveArray = (m: Model): boolean =>
    m.link && COLLECTION_TYPES.has(m.export)
      ? isPrimitiveArray(m.link)
      : PRIMITIVE_TYPES.has(m.type) &&
        !['date', 'date-time'].includes(m.format ?? '');
  const arrayComposedModels = composedPrimitives.filter(
    (m) => m.export === 'array' && !isPrimitiveArray(m),
  );
  if (arrayComposedModels.length > 1) {
    throw new Error(
      `Schema "${model.name}" defines ${camelCase(model.export)} with multiple array types which cannot be distinguished at runtime.`,
    );
  }

  if (model.export === 'all-of' && composedPrimitives.length > 0) {
    throw new Error(
      `Schema "${model.name}" defines allOf with non-object types. allOf may only compose object types in the OpenAPI specification.`,
    );
  }

  model.composedModels = composedModels;
  model.composedPrimitives = composedPrimitives;
};

const addLanguageTypes = (model: Model) => {
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

const isOperationMutation = (op: Operation): boolean => {
  // x-mutation/x-query override the HTTP-method default.
  const { vendorExtensions } = op;
  if (vendorExtensions?.[VENDOR_EXTENSIONS.MUTATION]) {
    return true;
  } else if (vendorExtensions?.[VENDOR_EXTENSIONS.QUERY]) {
    return false;
  }
  return ['PATCH', 'POST', 'PUT', 'DELETE'].includes(op.method);
};

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
const getCursorOptions = (
  op: Operation,
): { paginationDisabled: boolean; cursorPropertyName: string } => {
  const cursor = op.vendorExtensions?.[VENDOR_EXTENSIONS.CURSOR];

  // Defaults: pagination enabled, paging on a property named 'cursor'.
  if (cursor === false) {
    return { paginationDisabled: true, cursorPropertyName: 'cursor' };
  }
  if (typeof cursor === 'string') {
    return { paginationDisabled: false, cursorPropertyName: cursor };
  }
  const options = (cursor ?? {}) as { enabled?: boolean; inputToken?: unknown };
  return {
    paginationDisabled: options.enabled === false,
    cursorPropertyName:
      typeof options.inputToken === 'string' ? options.inputToken : 'cursor',
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
