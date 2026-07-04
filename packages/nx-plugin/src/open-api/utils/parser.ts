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
 * The set of OpenAPI primitive `type` values, mapped to the internal model
 * `type` used by the code generator.
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

/**
 * A stable sort (preserves original order of equal elements).
 */
const stableSort = <T>(items: T[], compare: (a: T, b: T) => number): T[] =>
  items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => compare(a.item, b.item) || a.index - b.index)
    .map(({ item }) => item);

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
 * Resolve the "primary" type of a schema, ignoring 'null' in a 3.1 type array.
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

const compositeMembers = (
  schema: Schema,
): (Schema | OpenAPIV3.ReferenceObject)[] =>
  (schema.allOf ?? schema.anyOf ?? schema.oneOf ?? []) as (
    | Schema
    | OpenAPIV3.ReferenceObject
  )[];

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

export class OpenApiParser {
  constructor(private readonly spec: Spec) {}

  /**
   * Build the full client data structure from the spec.
   */
  public build(): ClientData {
    return {
      models: this.buildModels(),
      services: [this.buildDefaultService()],
    };
  }

  // --- Models ---------------------------------------------------------------

  private buildModels(): Model[] {
    const schemas = this.spec.components?.schemas ?? {};
    const models = Object.entries(schemas).map(([name, schemaOrRef]) =>
      this.buildDefinitionModel(name, resolveIfRef(this.spec, schemaOrRef)),
    );
    this.collapseDiscriminatorProperties(models);
    return models;
  }

  /**
   * Build a model for a top-level named schema (a definition).
   */
  private buildDefinitionModel(name: string, schema: Schema): Model {
    const model = createModel({
      name,
      description: schema.description ?? null,
      deprecated: !!schema.deprecated,
      isNullable: isNullable(schema),
    });
    this.populateModelFromSchema(model, schema);
    return model;
  }

  /**
   * Build a model for an inline sub-schema (property value, array item,
   * dictionary value, composite member, parameter, or response).
   */
  private buildInlineModel(
    schemaOrRef: Schema | OpenAPIV3.ReferenceObject,
  ): Model {
    if (isRef(schemaOrRef)) {
      const name = splitRef(schemaOrRef.$ref)[2];
      return createModel({
        export: 'reference',
        type: name,
        imports: [name],
      });
    }

    const schema = schemaOrRef;
    const model = createModel({
      description: schema.description ?? null,
      deprecated: !!schema.deprecated,
      isNullable: isNullable(schema),
      isReadOnly: !!schema.readOnly,
    });
    this.populateModelFromSchema(model, schema);
    return model;
  }

  /**
   * Populate a model's structural fields (export/type/link/properties/imports)
   * from a schema.
   */
  private populateModelFromSchema(model: Model, schema: Schema): void {
    // Enums (string enums are hoisted to definitions by normalise; integer and
    // other enums may remain inline on properties).
    if (isEnumSchema(schema)) {
      model.export = 'enum';
      model.type = 'string';
      model.enum = schema.enum!.map(
        (value): EnumMember => ({ value: value as EnumMember['value'] }),
      );
      return;
    }

    // Composite schemas (allOf/anyOf/oneOf).
    const composite = compositeExport(schema);
    if (composite) {
      model.export = composite;
      model.type = 'unknown';
      model.properties = compositeMembers(schema).map((member) =>
        this.buildInlineModel(member),
      );
      model.imports = collectImports(model.properties);
      return;
    }

    const type = primaryType(schema);

    // Arrays.
    if (type === 'array') {
      model.export = 'array';
      const items = (schema as { items?: Schema | OpenAPIV3.ReferenceObject })
        .items;
      this.applyCollectionValue(model, items);
      return;
    }

    // Dictionaries (maps): objects with additionalProperties / bare objects.
    if (isDictionarySchema(schema)) {
      model.export = 'dictionary';
      this.applyDictionaryValue(model, schema);
      return;
    }

    // Objects with properties → interface.
    if (type === 'object' || schema.properties || schema.patternProperties) {
      model.export = 'interface';
      model.type = 'unknown';
      model.properties = this.buildProperties(schema);
      model.imports = collectImports(model.properties);
      return;
    }

    // A schema with no type (e.g. `{}`) is treated as an untyped object.
    if (type === undefined) {
      model.export = 'interface';
      model.type = 'unknown';
      return;
    }

    // Primitives.
    model.export = 'generic';
    model.type = primitiveType(schema);
    if (schema.format) {
      model.format = schema.format;
    }
  }

  /**
   * Apply the value type of a dictionary (map) to a model.
   */
  private applyDictionaryValue(model: Model, schema: Schema): void {
    const additional = schema.additionalProperties;
    if (additional && additional !== true) {
      // additionalProperties with a schema (or a ref).
      this.applyCollectionValue(model, additional);
    } else if (schema.properties && additional !== true) {
      // An object with an (empty) `properties` map but no additionalProperties
      // renders as `{}` (a dictionary with no value type / link).
      model.type = 'unknown';
      model.link = null;
    } else {
      // `additionalProperties: true`, or a bare `{ type: 'object' }` → an "any"
      // value type (represented as an interface/unknown link).
      model.type = 'unknown';
      model.link = createModel({ export: 'interface', type: 'unknown' });
    }
  }

  /**
   * Apply the value type of a collection (array items / dictionary values) to a
   * model, setting `type`, `link` and `imports`.
   *
   * - ref value → `type` is the referenced model name; `link` is left null and
   *   resolved later by `ensureModelLinks`.
   * - non-ref value → recurse to build a `link` model, propagating the
   *   (innermost) type and imports up the collection chain.
   */
  private applyCollectionValue(
    model: Model,
    value: Schema | OpenAPIV3.ReferenceObject | undefined,
  ): void {
    if (value && isRef(value)) {
      model.type = splitRef(value.$ref)[2];
      model.imports = [model.type];
      model.link = null;
      return;
    }

    const link = createModel();
    this.populateModelFromSchema(link, (value ?? {}) as Schema);
    model.link = link;
    model.type = link.type;
    model.imports = [...link.imports];
  }

  /**
   * Build the property models for an object schema.
   */
  private buildProperties(schema: Schema): Model[] {
    const required = new Set(schema.required ?? []);
    return Object.entries(schema.properties ?? {}).map(([name, propSchema]) => {
      const property = this.buildInlineModel(propSchema);
      property.name = name;
      property.isRequired = required.has(name);
      return property;
    });
  }

  /**
   * When a composite schema declares a `discriminator` with an explicit
   * `mapping`, collapse the discriminator property in each mapped schema from
   * its enum reference to the bare primitive type: `export` stays `reference`,
   * `type` becomes the primitive (e.g. `string`), and `imports` are cleared.
   * The referenced enum models are left in place. This drops the literal
   * narrowing but keeps the emitted code valid.
   */
  private collapseDiscriminatorProperties(models: Model[]): void {
    const modelsByName = new Map(models.map((m) => [m.name, m]));
    const schemas = this.spec.components?.schemas ?? {};

    for (const schemaOrRef of Object.values(schemas)) {
      const discriminator = (resolveIfRef(this.spec, schemaOrRef) as Schema)
        .discriminator;
      if (!discriminator?.propertyName || !discriminator.mapping) continue;

      for (const mappedRef of Object.values(discriminator.mapping)) {
        if (typeof mappedRef !== 'string' || !mappedRef.startsWith('#/')) {
          continue;
        }
        const mappedModel = modelsByName.get(splitRef(mappedRef)[2]);
        const property = mappedModel?.properties.find(
          (p) => p.name === discriminator.propertyName,
        );
        if (property?.export !== 'reference') continue;

        const referenced = modelsByName.get(property.type);
        if (referenced?.export !== 'enum') continue;

        property.type = referenced.type;
        property.imports = [];
      }
    }
  }

  // --- Services & operations ------------------------------------------------

  private buildDefaultService(): Service {
    const operations = this.buildOperations();
    return {
      name: 'Default',
      operations,
      imports: [...new Set(operations.flatMap((op) => op.imports))],
    };
  }

  private buildOperations(): Operation[] {
    return Object.entries(this.spec.paths ?? {}).flatMap(
      ([path, pathItemOrRef]) => {
        const pathItem = resolveIfRef(this.spec, pathItemOrRef) as
          | OpenAPIV3.PathItemObject
          | undefined;
        if (!pathItem) return [];
        return HTTP_METHODS.flatMap((method: HttpMethod) => {
          const specOp = pathItem[method as OpenAPIV3.HttpMethods];
          return specOp ? [this.buildOperation(path, method, specOp)] : [];
        });
      },
    );
  }

  private buildOperation(
    path: string,
    method: string,
    specOp: OpenAPIV3.OperationObject,
  ): Operation {
    const parameters = this.buildParameters(specOp);
    const responses = this.buildResponses(specOp);
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
  }

  /**
   * Build the parameter models for an operation, including a synthetic body
   * parameter for the request body. The body parameter object is the same
   * reference stored on `parametersBody`, so downstream mutations propagate to
   * both.
   */
  private buildParameters(specOp: OpenAPIV3.OperationObject): Model[] {
    const params: Model[] = (specOp.parameters ?? []).flatMap((p) => {
      const param = resolveIfRef(this.spec, p) as
        | OpenAPIV3.ParameterObject
        | undefined;
      if (!param) return [];
      const model = this.buildInlineModel((param.schema ?? {}) as Schema);
      model.name = param.name;
      model.prop = param.name;
      model.in = param.in as ModelIn;
      model.mediaType = null;
      model.isRequired = !!param.required;
      if (param.description) {
        model.description = param.description;
      }
      return [model];
    });

    const body = this.buildRequestBody(specOp);
    if (body) {
      params.push(body);
    }

    // Order parameters required-first with a stable sort that preserves the
    // original relative order within each group (the body parameter takes part
    // in the sort at its appended position).
    return stableSort(params, (a, b) =>
      a.isRequired === b.isRequired ? 0 : a.isRequired ? -1 : 1,
    );
  }

  /**
   * Build the synthetic `body` parameter for an operation's request body.
   */
  private buildRequestBody(specOp: OpenAPIV3.OperationObject): Model | null {
    const requestBody = resolveIfRef(this.spec, specOp.requestBody) as
      | OpenAPIV3.RequestBodyObject
      | undefined;
    if (!requestBody?.content) return null;

    const mediaType = preferredMediaType(requestBody.content);
    const model = this.buildInlineModel(
      (requestBody.content[mediaType]?.schema ?? {}) as Schema,
    );
    model.name = 'requestBody';
    model.prop = 'requestBody';
    model.in = 'body';
    model.mediaType = mediaType;
    model.isRequired = !!requestBody.required;
    return model;
  }

  /**
   * Build the response models for an operation.
   */
  private buildResponses(specOp: OpenAPIV3.OperationObject): Model[] {
    return Object.entries(specOp.responses ?? {}).flatMap(
      ([code, resOrRef]) => {
        const response = resolveIfRef(this.spec, resOrRef) as
          | OpenAPIV3.ResponseObject
          | undefined;
        if (!response) return [];

        const content = response.content ?? {};
        const mediaType = Object.keys(content).length
          ? preferredMediaType(content)
          : undefined;
        const responseSchema = mediaType
          ? (content[mediaType]?.schema as
              | Schema
              | OpenAPIV3.ReferenceObject
              | undefined)
          : undefined;

        const model = responseSchema
          ? this.buildInlineModel(responseSchema)
          : createModel({ export: 'generic', type: 'void' });

        model.name = '';
        model.code = parseResponseCode(code);
        model.in = 'response';
        model.description = response.description ?? null;
        return [model];
      },
    );
  }
}

/**
 * Determine the internal primitive type name for a primitive schema.
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
 * Collect the unique imports declared across a set of models, in first-seen
 * order.
 */
const collectImports = (models: Model[]): string[] => [
  ...new Set(models.flatMap((m) => m.imports)),
];

/**
 * Build the initial client data structure from a (normalised) OpenAPI spec.
 */
export const buildClientData = (spec: Spec): ClientData =>
  new OpenApiParser(spec).build();
