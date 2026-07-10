/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import camelCase from 'lodash.camelcase';
import trim from 'lodash.trim';
import type { OpenAPIV3 } from 'openapi-types';
import {
  type ClientData,
  COLLECTION_TYPES,
  COMPOSED_SCHEMA_TYPES,
  createModel,
  DEFAULT_SERVICE_NAME,
  type Discriminator,
  type DiscriminatorMapping,
  type EnumMember,
  indexModelsByName,
  type Model,
  type ModelExport,
  type ModelIn,
  type ModelsByName,
  type Operation,
  PRIMITIVE_TYPES,
  type Service,
} from './codegen-data/types';
import { isRef, resolveIfRef, splitRef } from './refs';
import type {
  OpenApiSchemaOrRef,
  OpenApiSchema as Schema,
  Spec,
} from './types';

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

type ParameterOrRef = OpenAPIV3.ParameterObject | OpenAPIV3.ReferenceObject;

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
  if (type === 'string' && isBinaryStringSchema(schema)) return 'binary';
  return (type && PRIMITIVE_TYPE_MAP[type]) ?? 'unknown';
};

/**
 * Whether a `string` schema denotes raw binary content (rendered as a `Blob`).
 * Covers the 3.0 `format: binary` idiom and the 3.1 `contentMediaType` idiom
 * (as emitted by FastAPI for `UploadFile`). A base64 `contentEncoding`, or a
 * textual/JSON media type, keeps the value a string on the wire.
 */
const isBinaryStringSchema = (schema: Schema): boolean => {
  if (schema.format === 'binary') return true;
  const contentMediaType = schema.contentMediaType;
  if (!contentMediaType || schema.contentEncoding) return false;
  return !(
    contentMediaType.startsWith('text/') ||
    contentMediaType === 'application/json' ||
    contentMediaType.endsWith('+json') ||
    contentMediaType === 'application/xml'
  );
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

/**
 * The structural fields (export/type/link/properties/enum/imports/format) a
 * schema contributes to a model.
 */
const schemaStructure = (spec: Spec, schema: Schema): Partial<Model> => {
  // A null member (3.0 nullable enums list null as a value) marks the model
  // nullable rather than becoming a literal. An enum of only null degrades to
  // a plain (nullable) schema.
  const enumMembers = (schema.enum ?? []).filter((value) => value !== null);
  if (isEnumSchema(schema) && enumMembers.length > 0) {
    // A string (or untyped) enum renders as a literal union; a boolean/number
    // enum renders as its bare primitive, so it must carry the declared type.
    const declared = primaryType(schema);
    return {
      export: 'enum',
      type: (declared && PRIMITIVE_TYPE_MAP[declared]) ?? 'string',
      enum: enumMembers.map(
        (value): EnumMember => ({ value: value as EnumMember['value'] }),
      ),
      ...(enumMembers.length < schema.enum!.length ? { isNullable: true } : {}),
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
 *   resolved later by `linkModels`.
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
export const buildInlineModel = (
  spec: Spec,
  schemaOrRef: SchemaOrRef,
): Model => {
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
 * A model for a top-level named schema (a definition). Object definitions are
 * typed as their own name (the type the generator emits for them).
 */
const buildDefinitionModel = (
  spec: Spec,
  name: string,
  schema: Schema,
): Model => {
  const structure = schemaStructure(spec, schema);
  const isNamedObject =
    schema.type === 'object' &&
    !!(schema.properties || schema.patternProperties);
  return createModel({
    name,
    description: schema.description ?? null,
    deprecated: !!schema.deprecated,
    isNullable: isNullable(schema),
    ...structure,
    ...(isNamedObject ? { type: name } : {}),
  });
};

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
      if (typeof mappedRef !== 'string' || !mappedRef.startsWith('#/'))
        continue;
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

/**
 * The synthetic `body` parameter for an operation's request body.
 */
const buildRequestBody = (
  spec: Spec,
  specOp: OpenAPIV3.OperationObject,
): Model | null => {
  const requestBody = resolveIfRef<OpenAPIV3.RequestBodyObject | undefined>(
    spec,
    specOp.requestBody,
  );
  // An empty content map declares no acceptable media types, ie no body.
  if (!requestBody?.content || Object.keys(requestBody.content).length === 0)
    return null;

  const mediaType = preferredMediaType(requestBody.content);
  const base = buildInlineModel(
    spec,
    (requestBody.content[mediaType]?.schema ?? {}) as Schema,
  );
  return {
    ...base,
    name: 'requestBody',
    prop: 'requestBody',
    in: 'body',
    mediaType,
    isRequired: !!requestBody.required,
    description: requestBody.description ?? base.description,
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
  pathParameters: ParameterOrRef[] = [],
): Model[] => {
  const declared: Model[] = mergeParameters(spec, pathParameters, [
    ...(specOp.parameters ?? []),
  ]).flatMap((p) => {
    const param = resolveIfRef<OpenAPIV3.ParameterObject | undefined>(spec, p);
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
 * Merge path-level parameters with operation-level parameters. Per the OpenAPI
 * spec, path-level parameters apply to every operation in the path unless an
 * operation-level parameter overrides one with the same `name` + `in`.
 */
const mergeParameters = (
  spec: Spec,
  pathParameters: ParameterOrRef[],
  operationParameters: ParameterOrRef[],
): ParameterOrRef[] => {
  const key = (p: ParameterOrRef) => {
    const param = resolveIfRef<OpenAPIV3.ParameterObject | undefined>(spec, p);
    return param ? specParameterKey(param) : null;
  };
  const overridden = new Set(operationParameters.map(key));
  const inherited = pathParameters.filter((p) => !overridden.has(key(p)));
  return [...inherited, ...operationParameters];
};

/**
 * The response models for an operation.
 */
const buildResponses = (
  spec: Spec,
  specOp: OpenAPIV3.OperationObject,
): Model[] =>
  Object.entries(specOp.responses ?? {}).flatMap(([code, resOrRef]) => {
    const response = resolveIfRef<OpenAPIV3.ResponseObject | undefined>(
      spec,
      resOrRef,
    );
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
  pathParameters: ParameterOrRef[] = [],
): Operation => {
  const parameters = buildParameters(spec, specOp, pathParameters);
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
    const pathItem = resolveIfRef<OpenAPIV3.PathItemObject | undefined>(
      spec,
      pathItemOrRef,
    );
    if (!pathItem) return [];
    const pathParameters = pathItem.parameters ?? [];
    return HTTP_METHODS.flatMap((method: HttpMethod) => {
      const specOp = pathItem[method as OpenAPIV3.HttpMethods];
      return specOp
        ? [buildOperation(spec, path, method, specOp, pathParameters)]
        : [];
    });
  });

const buildDefaultService = (spec: Spec): Service => {
  const operations = buildOperations(spec);
  return {
    name: DEFAULT_SERVICE_NAME,
    operations,
    imports: [...new Set(operations.flatMap((op) => op.imports))],
  };
};

/**
 * Look up the spec operation object for a parsed operation.
 */
export const getSpecOperation = (
  spec: Spec,
  op: Operation,
): OpenAPIV3.OperationObject | undefined =>
  (spec.paths?.[op.path] as OpenAPIV3.PathItemObject | undefined)?.[
    op.method.toLowerCase() as OpenAPIV3.HttpMethods
  ];

/**
 * The `in`-qualified key for a parameter, distinguishing parameters that share
 * a name across positions (e.g. `id` in both path and query).
 */
export const specParameterKey = (parameter: {
  in: string;
  name: string;
}): string => `${parameter.in}:${parameter.name}`;

/**
 * An operation's resolved parameters indexed by `in:name`, including any
 * path-level parameters inherited from the containing path item
 * (operation-level parameters take precedence when both declare the same
 * `name` + `in`).
 */
export const getSpecParametersByKey = (
  spec: Spec,
  specOp: OpenAPIV3.OperationObject | undefined,
  pathParameters: ParameterOrRef[] = [],
): { [key: string]: OpenAPIV3.ParameterObject } =>
  Object.fromEntries(
    [...pathParameters, ...(specOp?.parameters ?? [])].map((p) => {
      const param = resolveIfRef(spec, p);
      return [specParameterKey(param), param];
    }),
  );

/**
 * The path-level parameters declared on the path item containing an operation.
 */
export const getSpecPathParameters = (
  spec: Spec,
  op: Operation,
): ParameterOrRef[] => {
  const pathItem = resolveIfRef<OpenAPIV3.PathItemObject | undefined>(
    spec,
    spec.paths?.[op.path],
  );
  return pathItem?.parameters ?? [];
};

/**
 * The member sub-schemas of a composite (allOf/anyOf/oneOf) schema, in order.
 */
export const compositeMemberSchemas = (
  schema: Schema,
  compositeExport: ModelExport,
): OpenApiSchemaOrRef[] => {
  const keyword = camelCase(compositeExport) as 'allOf' | 'anyOf' | 'oneOf';
  return (schema[keyword] as OpenApiSchemaOrRef[] | undefined) ?? [];
};

/**
 * Recursively stitch a model's collection `link` to the named model it
 * references (ref values are left null by the builders, since the target model
 * does not exist until every definition is built).
 */
export const linkModel = (
  spec: Spec,
  modelsByName: ModelsByName,
  model: Model,
  schema: Schema,
  visited: Set<Model> = new Set(),
): void => {
  if (visited.has(model)) return;
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
      linkModel(
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
      linkModel(spec, modelsByName, model.link, schema.items, visited);
    }
  }

  model.properties
    .filter((p) => !visited.has(p) && schema.properties?.[trim(p.name, `"'`)])
    .forEach((property) => {
      const subSchema = resolveIfRef(
        spec,
        schema.properties![trim(property.name, `"'`)],
      );
      linkModel(spec, modelsByName, property, subSchema, visited);
    });

  if (COMPOSED_SCHEMA_TYPES.has(model.export)) {
    const memberSchemas = compositeMemberSchemas(schema, model.export);
    model.properties.forEach((property, i) => {
      const subSchema = resolveIfRef(spec, memberSchemas[i]);
      if (subSchema) {
        linkModel(spec, modelsByName, property, subSchema, visited);
      }
    });
  }
};

/**
 * Stitch collection links across every model, operation parameter and response.
 */
const linkModels = (spec: Spec, data: ClientData): void => {
  const modelsByName = indexModelsByName(data.models);
  const visited = new Set<Model>();

  data.models.forEach((model) => {
    const schema = resolveIfRef<Schema | undefined>(
      spec,
      spec.components?.schemas?.[model.name],
    );
    if (schema) {
      linkModel(spec, modelsByName, model, schema, visited);
    }
  });

  data.services.forEach((service) => {
    service.operations.forEach((op) => {
      const specOp = getSpecOperation(spec, op);
      const specParametersByKey = getSpecParametersByKey(
        spec,
        specOp,
        getSpecPathParameters(spec, op),
      );

      op.parameters.forEach((parameter) => {
        const specParameter =
          specParametersByKey[
            specParameterKey({ in: parameter.in, name: parameter.prop })
          ];
        const specParameterSchema = resolveIfRef(spec, specParameter?.schema);
        if (specParameterSchema) {
          linkModel(
            spec,
            modelsByName,
            parameter,
            specParameterSchema,
            visited,
          );
        } else if (parameter.in === 'body') {
          const specBody = resolveIfRef(spec, specOp?.requestBody);
          const specBodySchema = resolveIfRef(
            spec,
            specBody?.content?.[parameter.mediaType]?.schema,
          );
          if (specBodySchema) {
            linkModel(spec, modelsByName, parameter, specBodySchema, visited);
          }
        }
      });

      op.responses.forEach((response) => {
        const specResponse = resolveIfRef(
          spec,
          specOp?.responses?.[response.code],
        );
        Object.keys(specResponse?.content ?? {}).forEach((mediaType) => {
          const responseSchema = resolveIfRef(
            spec,
            specResponse?.content?.[mediaType]?.schema,
          );
          if (responseSchema) {
            linkModel(spec, modelsByName, response, responseSchema, visited);
          }
        });
      });
    });
  });
};

/**
 * Populate `composedModels` and `composedPrimitives` on each composite model
 * with the models and primitive types it is composed of.
 */
const resolveComposedModel = (
  modelsByName: ModelsByName,
  model: Model,
  visited: Set<Model>,
): void => {
  if (!COMPOSED_SCHEMA_TYPES.has(model.export) || visited.has(model)) return;
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

  // A composite of multiple non-primitive array members can't be told apart at
  // runtime: each arrives as a plain JSON array with no property to switch on.
  // A `discriminator` can't disambiguate here either — it names a property on
  // an object member, not on an array. Model a polymorphic list as an array of
  // a discriminated union instead (`type: array` whose `items` is the oneOf).
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
      `Schema "${model.name}" defines ${camelCase(model.export)} with multiple array types which cannot be distinguished at runtime. Model a polymorphic list as an array whose items are a discriminated union instead (a "type: array" schema with a "oneOf" in "items").`,
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

const resolveComposedModels = (data: ClientData): void => {
  const modelsByName = indexModelsByName(data.models);
  const visited = new Set<Model>();
  data.models.forEach((model) =>
    resolveComposedModel(modelsByName, model, visited),
  );
};

const isHoisted = (spec: Spec, name: string): boolean =>
  !!(
    resolveIfRef<Schema | undefined>(spec, spec.components?.schemas?.[name]) as
      | { 'x-aws-nx-hoisted'?: boolean }
      | undefined
  )?.['x-aws-nx-hoisted'];

/**
 * The on-the-wire name of a schema: its original name before normalisation to
 * a valid identifier (recorded by the normaliser), or its current name. An
 * implicit discriminator matches on this, not the normalised model name.
 */
const wireName = (spec: Spec, name: string): string =>
  (
    resolveIfRef<Schema | undefined>(
      spec,
      spec.components?.schemas?.[name],
    ) as { 'x-aws-nx-original-name'?: string } | undefined
  )?.['x-aws-nx-original-name'] ?? name;

/**
 * The value → model-name mapping for a discriminator, resolved either from an
 * explicit `mapping` (value → schema ref) or implicitly (each candidate model's
 * schema name is its own discriminator value). Only candidates in
 * `candidateNames` are kept, so unknown values fall through to the default
 * marshalling; hoisted synthetic names (which never appear on the wire) are
 * excluded from the implicit form.
 */
const buildDiscriminatorMapping = (
  spec: Spec,
  discriminator: OpenAPIV3.DiscriminatorObject,
  candidateNames: Set<string>,
): DiscriminatorMapping[] => {
  if (discriminator.mapping) {
    const mapping: DiscriminatorMapping[] = [];
    for (const [value, ref] of Object.entries(discriminator.mapping)) {
      if (typeof ref !== 'string' || !ref.startsWith('#/')) continue;
      const modelName = splitRef(ref)[2];
      if (candidateNames.has(modelName)) mapping.push({ value, modelName });
    }
    return mapping;
  }
  return [...candidateNames]
    .filter((name) => !isHoisted(spec, name))
    // The wire value is the schema's original name; the model it selects is the
    // normalised name.
    .map((name) => ({ value: wireName(spec, name), modelName: name }));
};

/**
 * Build the {@link Discriminator} for a `oneOf`/`anyOf` composite, if declared.
 * The candidates are the models composed by the union.
 */
const buildCompositeDiscriminator = (
  spec: Spec,
  model: Model,
  schema: Schema,
): Discriminator | undefined => {
  const { discriminator } = schema;
  if (!discriminator?.propertyName) return undefined;

  const candidateNames = new Set(
    (model.composedModels ?? []).map((m) => m.name),
  );
  const mapping = buildDiscriminatorMapping(
    spec,
    discriminator,
    candidateNames,
  );

  return mapping.length > 0
    ? { propertyName: discriminator.propertyName, mapping }
    : undefined;
};

/**
 * Build the {@link Discriminator} for an inheritance base — an `object` schema
 * carrying a `discriminator` whose subtypes `allOf`-compose it. The candidates
 * are those subtypes (found by scanning every model for one that composes this
 * base). Marked `isBase` so the generator emits a non-dispatching body the
 * subtypes can compose without recursing.
 */
const buildBaseDiscriminator = (
  spec: Spec,
  base: Model,
  schema: Schema,
  models: Model[],
): Discriminator | undefined => {
  const { discriminator } = schema;
  if (!discriminator?.propertyName) return undefined;

  const subtypeNames = new Set(
    models
      .filter(
        (m) =>
          m.export === 'all-of' &&
          (m.composedModels ?? []).some((c) => c.name === base.name),
      )
      .map((m) => m.name),
  );
  if (subtypeNames.size === 0) return undefined;

  const mapping = buildDiscriminatorMapping(spec, discriminator, subtypeNames);

  return mapping.length > 0
    ? { propertyName: discriminator.propertyName, mapping, isBase: true }
    : undefined;
};

/**
 * Attach discriminator metadata so the generator can marshal directly to the
 * matching branch/subtype. Two shapes carry a discriminator:
 *  - a `oneOf`/`anyOf` composite (dispatch to the matching member), and
 *  - an inheritance base `object` whose subtypes `allOf`-compose it (dispatch
 *    to the matching subtype so subtype-only fields survive marshalling).
 * `allOf` itself is a conjunction (not a choice) so it is never discriminated.
 */
const resolveDiscriminators = (spec: Spec, data: ClientData): void => {
  data.models.forEach((model) => {
    const schema = resolveIfRef<Schema | undefined>(
      spec,
      spec.components?.schemas?.[model.name],
    );
    if (!schema) return;

    if (model.export === 'one-of' || model.export === 'any-of') {
      const discriminator = buildCompositeDiscriminator(spec, model, schema);
      if (discriminator) model.discriminator = discriminator;
    } else if (model.export === 'interface') {
      const discriminator = buildBaseDiscriminator(
        spec,
        model,
        schema,
        data.models,
      );
      if (discriminator) model.discriminator = discriminator;
    }
  });
};

/**
 * Type each discriminated subtype's discriminator property as its literal
 * value(s), turning `Cat | Dog` into a true TypeScript tagged union that
 * narrows on the discriminator (e.g. `Cat.petType: 'cat'`).
 *
 * The literal is taken from every discriminator's `mapping` (value → subtype).
 * A subtype selected by several values within one discriminator becomes a union
 * of those literals. A subtype that appears in multiple discriminators with
 * conflicting values can't be pinned to a single literal, so it is left as the
 * plain primitive (`string`) — the marshalling dispatch is unaffected either
 * way, this only affects the emitted type.
 */
const resolveDiscriminatorLiterals = (data: ClientData): void => {
  const modelsByName = indexModelsByName(data.models);

  // Collect, per (subtype, discriminator property), the set of literal values
  // that select it — across every discriminator in the spec.
  const valuesBySubtypeProp = new Map<string, Set<string>>();
  const conflicting = new Set<string>();

  for (const model of data.models) {
    const discriminator = model.discriminator;
    if (!discriminator) continue;
    const byName = new Map<string, string[]>();
    for (const { value, modelName } of discriminator.mapping) {
      byName.set(modelName, [...(byName.get(modelName) ?? []), value]);
    }
    for (const [modelName, values] of byName) {
      const key = `${modelName} ${discriminator.propertyName}`;
      const existing = valuesBySubtypeProp.get(key);
      const incoming = new Set(values);
      if (existing && !setsEqual(existing, incoming)) {
        // Same subtype+property tagged differently by another union.
        conflicting.add(key);
      }
      valuesBySubtypeProp.set(key, existing ? union(existing, incoming) : incoming);
    }
  }

  for (const [key, values] of valuesBySubtypeProp) {
    if (conflicting.has(key)) continue;
    const [modelName, propertyName] = key.split(' ');
    const property = modelsByName[modelName]?.properties.find(
      (p) => p.name === propertyName,
    );
    // Only pin a literal when the property is a plain (string/enum) scalar —
    // never an object/array reference.
    if (property && (property.type === 'string' || property.isEnum)) {
      property.discriminatorValue = [...values]
        .map((v) => JSON.stringify(v))
        .join(' | ');
    }
  }
};

const setsEqual = (a: Set<string>, b: Set<string>): boolean =>
  a.size === b.size && [...a].every((v) => b.has(v));

const union = (a: Set<string>, b: Set<string>): Set<string> =>
  new Set([...a, ...b]);

/**
 * Build the client data structure from a (normalised) OpenAPI spec: a fully
 * linked model graph with composite members resolved, ready for augmentation.
 */
export const buildClientData = (spec: Spec): ClientData => {
  const data: ClientData = {
    models: buildModels(spec),
    services: [buildDefaultService(spec)],
  };
  linkModels(spec, data);
  resolveComposedModels(data);
  resolveDiscriminators(spec, data);
  resolveDiscriminatorLiterals(data);
  return data;
};
