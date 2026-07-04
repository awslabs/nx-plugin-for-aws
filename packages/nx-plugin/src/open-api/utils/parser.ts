/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Parses an OpenAPI spec into the initial {@link ClientData} structure consumed
 * by {@link buildOpenApiCodeGenData}, which then enriches it with
 * language-specific and code-generation fields.
 *
 * The spec must already have been run through
 * {@link normaliseOpenApiSpecForCodeGen}, which hoists inline
 * object/enum/composite schemas into named components and inlines refs to
 * primitives, so that every non-primitive is a named schema and every operation
 * has an `operationId`.
 */

import type { OpenAPIV3 } from 'openapi-types';
import {
  type ClientData,
  createModel,
  type EnumMember,
  type Model,
  type ModelExport,
  type ModelIn,
  type Operation,
  type Service,
} from './codegen-data/types';
import { isRef, resolveIfRef, splitRef } from './refs';
import type { OpenApiSchema as Schema, Spec } from './types';

/**
 * OpenAPI primitive `type` values mapped to the internal model `type`.
 */
const PRIMITIVE_TYPE_MAP: { [openApiType: string]: string } = {
  string: 'string',
  number: 'number',
  integer: 'number',
  boolean: 'boolean',
  null: 'null',
};

const HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const;

type HttpMethod = (typeof HTTP_METHODS)[number];

type SchemaOrRef = Schema | OpenAPIV3.ReferenceObject;

const schemaType = (schema: Schema): string | string[] | undefined =>
  (schema as { type?: string | string[] }).type;

const isNullable = (schema: Schema): boolean => {
  const type = schemaType(schema);
  return (
    schema.nullable === true ||
    type === 'null' ||
    (Array.isArray(type) && type.includes('null'))
  );
};

/**
 * The "primary" type of a schema, ignoring 'null' in a 3.1 type array.
 */
const primaryType = (schema: Schema): string | undefined => {
  const type = schemaType(schema);
  return Array.isArray(type) ? type.find((t) => t !== 'null') : type;
};

const isEnumSchema = (schema: Schema): boolean =>
  Array.isArray(schema.enum) && schema.enum.length > 0;

const compositeExport = (schema: Schema): ModelExport | undefined => {
  if (schema.allOf) return 'all-of';
  if (schema.anyOf) return 'any-of';
  if (schema.oneOf) return 'one-of';
  return undefined;
};

const compositeMembers = (schema: Schema): SchemaOrRef[] =>
  (schema.allOf ?? schema.anyOf ?? schema.oneOf ?? []) as SchemaOrRef[];

/**
 * A schema is a "dictionary" (map) when it is an object with no explicit
 * properties (it may have `additionalProperties`, or be a bare `object`).
 */
const isDictionarySchema = (schema: Schema): boolean => {
  if (primaryType(schema) !== 'object') return false;
  if (compositeExport(schema) || isEnumSchema(schema)) return false;
  const hasProperties = Object.keys(schema.properties ?? {}).length > 0;
  return !hasProperties && !schema.patternProperties;
};

/**
 * The internal primitive type name for a primitive schema.
 */
const primitiveType = (schema: Schema): string => {
  const type = primaryType(schema);
  if (type === 'string' && schema.format === 'binary') return 'binary';
  return (type && PRIMITIVE_TYPE_MAP[type]) ?? 'unknown';
};

/**
 * Prefer application/json, falling back to the first declared media type.
 */
const preferredMediaType = (content: { [media: string]: unknown }): string =>
  'application/json' in content ? 'application/json' : Object.keys(content)[0];

const parseResponseCode = (code: string): number | string =>
  /^\d+$/.test(code) ? parseInt(code, 10) : code;

/**
 * The unique imports declared across a set of models, in first-seen order.
 */
const collectImports = (models: Model[]): string[] => [
  ...new Set(models.flatMap((m) => m.imports)),
];

// --- Models -----------------------------------------------------------------

/**
 * The structural fields (export/type/link/properties/enum/imports/format) a
 * schema contributes to a model.
 */
const schemaStructure = (spec: Spec, schema: Schema): Partial<Model> => {
  if (isEnumSchema(schema)) {
    return {
      export: 'enum',
      type: 'string',
      enum: schema.enum!.map(
        (value): EnumMember => ({ value: value as EnumMember['value'] }),
      ),
    };
  }

  const composite = compositeExport(schema);
  if (composite) {
    const properties = compositeMembers(schema).map((member) =>
      buildInlineModel(spec, member),
    );
    return {
      export: composite,
      type: 'unknown',
      properties,
      imports: collectImports(properties),
    };
  }

  const type = primaryType(schema);

  if (type === 'array') {
    const items = (schema as { items?: SchemaOrRef }).items;
    return { export: 'array', ...collectionValue(spec, items) };
  }

  if (isDictionarySchema(schema)) {
    return { export: 'dictionary', ...dictionaryValue(spec, schema) };
  }

  if (type === 'object' || schema.properties || schema.patternProperties) {
    const properties = buildProperties(spec, schema);
    return {
      export: 'interface',
      type: 'unknown',
      properties,
      imports: collectImports(properties),
    };
  }

  // A schema with no type (e.g. `{}`) is an untyped object.
  if (type === undefined) {
    return { export: 'interface', type: 'unknown' };
  }

  return {
    export: 'generic',
    type: primitiveType(schema),
    ...(schema.format ? { format: schema.format } : {}),
  };
};

/**
 * The value type of a collection (array items / dictionary values): a `type`,
 * `link` and `imports`.
 *
 * - ref value → `type` is the referenced model name; `link` is left null and
 *   resolved later by `ensureModelLinks`.
 * - non-ref value → a `link` model carrying the (innermost) type and imports.
 */
const collectionValue = (
  spec: Spec,
  value: SchemaOrRef | undefined,
): Partial<Model> => {
  if (value && isRef(value)) {
    const type = splitRef(value.$ref)[2];
    return { type, imports: [type], link: null };
  }
  const link = createModel(schemaStructure(spec, (value ?? {}) as Schema));
  return { link, type: link.type, imports: [...link.imports] };
};

/**
 * The value type of a dictionary (map).
 */
const dictionaryValue = (spec: Spec, schema: Schema): Partial<Model> => {
  const additional = schema.additionalProperties;
  if (additional && additional !== true) {
    return collectionValue(spec, additional);
  }
  if (schema.properties && additional !== true) {
    // An object with an (empty) `properties` map but no additionalProperties
    // renders as `{}`.
    return { type: 'unknown', link: null };
  }
  // `additionalProperties: true`, or a bare `{ type: 'object' }` → an "any"
  // value type.
  return {
    type: 'unknown',
    link: createModel({ export: 'interface', type: 'unknown' }),
  };
};

/**
 * A model for an inline sub-schema (property value, array item, dictionary
 * value, composite member, parameter, or response).
 */
const buildInlineModel = (spec: Spec, schemaOrRef: SchemaOrRef): Model => {
  if (isRef(schemaOrRef)) {
    const name = splitRef(schemaOrRef.$ref)[2];
    return createModel({ export: 'reference', type: name, imports: [name] });
  }
  return createModel({
    description: schemaOrRef.description ?? null,
    deprecated: !!schemaOrRef.deprecated,
    isNullable: isNullable(schemaOrRef),
    isReadOnly: !!schemaOrRef.readOnly,
    ...schemaStructure(spec, schemaOrRef),
  });
};

/**
 * A model for a top-level named schema (a definition).
 */
const buildDefinitionModel = (spec: Spec, name: string, schema: Schema): Model =>
  createModel({
    name,
    description: schema.description ?? null,
    deprecated: !!schema.deprecated,
    isNullable: isNullable(schema),
    ...schemaStructure(spec, schema),
  });

/**
 * The property models for an object schema.
 */
const buildProperties = (spec: Spec, schema: Schema): Model[] => {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([name, propSchema]) => ({
    ...buildInlineModel(spec, propSchema),
    name,
    isRequired: required.has(name),
  }));
};

/**
 * A `{ modelName → { propertyName } }` map of the discriminator properties
 * declared by composite schemas with an explicit `mapping`.
 */
const discriminatorTargets = (spec: Spec): Map<string, Set<string>> => {
  const targets = new Map<string, Set<string>>();
  for (const schemaOrRef of Object.values(spec.components?.schemas ?? {})) {
    const { discriminator } = resolveIfRef(spec, schemaOrRef) as Schema;
    if (!discriminator?.propertyName || !discriminator.mapping) continue;
    for (const mappedRef of Object.values(discriminator.mapping)) {
      if (typeof mappedRef !== 'string' || !mappedRef.startsWith('#/')) continue;
      const modelName = splitRef(mappedRef)[2];
      const properties = targets.get(modelName) ?? new Set<string>();
      properties.add(discriminator.propertyName);
      targets.set(modelName, properties);
    }
  }
  return targets;
};

/**
 * For discriminated composites, collapse each mapped schema's discriminator
 * property from its enum reference to the bare primitive type (`export` stays
 * `reference`, `type` becomes the primitive, `imports` are cleared). The
 * referenced enum models are left in place. This drops the literal narrowing
 * but keeps the emitted code valid.
 */
const collapseDiscriminators = (spec: Spec, models: Model[]): Model[] => {
  const targets = discriminatorTargets(spec);
  if (targets.size === 0) return models;

  const byName = new Map(models.map((m) => [m.name, m]));
  return models.map((model) => {
    const properties = targets.get(model.name);
    if (!properties) return model;
    return {
      ...model,
      properties: model.properties.map((property) => {
        if (!properties.has(property.name) || property.export !== 'reference') {
          return property;
        }
        const referenced = byName.get(property.type);
        return referenced?.export === 'enum'
          ? { ...property, type: referenced.type, imports: [] }
          : property;
      }),
    };
  });
};

const buildModels = (spec: Spec): Model[] =>
  collapseDiscriminators(
    spec,
    Object.entries(spec.components?.schemas ?? {}).map(([name, schemaOrRef]) =>
      buildDefinitionModel(spec, name, resolveIfRef(spec, schemaOrRef)),
    ),
  );

// --- Services & operations --------------------------------------------------

/**
 * The synthetic `body` parameter for an operation's request body.
 */
const buildRequestBody = (
  spec: Spec,
  specOp: OpenAPIV3.OperationObject,
): Model | null => {
  const requestBody = resolveIfRef(spec, specOp.requestBody) as
    | OpenAPIV3.RequestBodyObject
    | undefined;
  if (!requestBody?.content) return null;

  const mediaType = preferredMediaType(requestBody.content);
  return {
    ...buildInlineModel(
      spec,
      (requestBody.content[mediaType]?.schema ?? {}) as Schema,
    ),
    name: 'requestBody',
    prop: 'requestBody',
    in: 'body',
    mediaType,
    isRequired: !!requestBody.required,
  };
};

/**
 * The parameter models for an operation, including a synthetic body parameter.
 * Ordered required-first with a stable sort (`Array.prototype.sort`), so the
 * original relative order within each group is preserved.
 */
const buildParameters = (
  spec: Spec,
  specOp: OpenAPIV3.OperationObject,
): Model[] => {
  const declared: Model[] = (specOp.parameters ?? []).flatMap((p) => {
    const param = resolveIfRef(spec, p) as OpenAPIV3.ParameterObject | undefined;
    if (!param) return [];
    const base = buildInlineModel(spec, (param.schema ?? {}) as Schema);
    return [
      {
        ...base,
        name: param.name,
        prop: param.name,
        in: param.in as ModelIn,
        mediaType: null,
        isRequired: !!param.required,
        description: param.description ? param.description : base.description,
      },
    ];
  });

  const body = buildRequestBody(spec, specOp);
  const params = body ? [...declared, body] : declared;

  return [...params].sort((a, b) =>
    a.isRequired === b.isRequired ? 0 : a.isRequired ? -1 : 1,
  );
};

/**
 * The response models for an operation.
 */
const buildResponses = (
  spec: Spec,
  specOp: OpenAPIV3.OperationObject,
): Model[] =>
  Object.entries(specOp.responses ?? {}).flatMap(([code, resOrRef]) => {
    const response = resolveIfRef(spec, resOrRef) as
      | OpenAPIV3.ResponseObject
      | undefined;
    if (!response) return [];

    const content = response.content ?? {};
    const mediaType = Object.keys(content).length
      ? preferredMediaType(content)
      : undefined;
    const responseSchema = mediaType
      ? (content[mediaType]?.schema as SchemaOrRef | undefined)
      : undefined;

    return [
      {
        ...(responseSchema
          ? buildInlineModel(spec, responseSchema)
          : createModel({ export: 'generic', type: 'void' })),
        name: '',
        code: parseResponseCode(code),
        in: 'response' as ModelIn,
        description: response.description ?? null,
      },
    ];
  });

const buildOperation = (
  spec: Spec,
  path: string,
  method: string,
  specOp: OpenAPIV3.OperationObject,
): Operation => {
  const parameters = buildParameters(spec, specOp);
  const responses = buildResponses(spec, specOp);
  const id = (specOp as { operationId: string }).operationId;

  return {
    id,
    name: id,
    method: method.toUpperCase(),
    path,
    description: specOp.description ?? null,
    tags: specOp.tags ?? null,
    deprecated: !!specOp.deprecated,
    parameters,
    parametersBody: parameters.find((p) => p.in === 'body') ?? null,
    responses,
    imports: collectImports([...parameters, ...responses]),
  };
};

const buildOperations = (spec: Spec): Operation[] =>
  Object.entries(spec.paths ?? {}).flatMap(([path, pathItemOrRef]) => {
    const pathItem = resolveIfRef(spec, pathItemOrRef) as
      | OpenAPIV3.PathItemObject
      | undefined;
    if (!pathItem) return [];
    return HTTP_METHODS.flatMap((method: HttpMethod) => {
      const specOp = pathItem[method as OpenAPIV3.HttpMethods];
      return specOp ? [buildOperation(spec, path, method, specOp)] : [];
    });
  });

const buildDefaultService = (spec: Spec): Service => {
  const operations = buildOperations(spec);
  return {
    name: 'Default',
    operations,
    imports: [...new Set(operations.flatMap((op) => op.imports))],
  };
};

/**
 * Build the initial client data structure from a (normalised) OpenAPI spec.
 */
export const buildClientData = (spec: Spec): ClientData => ({
  models: buildModels(spec),
  services: [buildDefaultService(spec)],
});
