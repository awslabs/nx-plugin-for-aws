/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { OpenAPIV3, OpenAPIV3_1 } from 'openapi-types';

/**
 * The kind of a {@link Model}, describing how it should be rendered.
 *
 * - `interface` — an object type with named properties
 * - `enum` — a set of string/number literal values
 * - `array` — a list whose element type is described by `link`
 * - `tuple` — a fixed-length array (`prefixItems`) whose element types are the
 *   `properties`, in order
 * - `dictionary` — a map whose value type is described by `link`
 * - `reference` — a reference to another named model (`type` is its name)
 * - `generic` — a primitive (string/number/boolean/null/void/binary/any)
 * - `one-of` / `any-of` / `all-of` — a composite of other schemas
 */
export type ModelExport =
  | 'interface'
  | 'enum'
  | 'array'
  | 'tuple'
  | 'dictionary'
  | 'reference'
  | 'generic'
  | 'one-of'
  | 'any-of'
  | 'all-of';

/**
 * Where a parameter-like {@link Model} appears in a request/response.
 * Empty string is used for models that are not parameters (schemas/properties).
 */
export type ModelIn =
  | ''
  | 'query'
  | 'path'
  | 'header'
  | 'cookie'
  | 'body'
  | 'response';

/**
 * How array/object query & header parameters are serialised on the wire.
 * `deepObject` explodes an object into `key[prop]=value` query pairs.
 */
export type CollectionFormat = 'multi' | 'csv' | 'ssv' | 'pipes' | 'deepObject';

/** A single enum member value. */
export interface EnumMember {
  value: string | number | boolean;
}

/**
 * A discriminated-composite mapping entry: a discriminator value and the name
 * of the composed model it selects.
 */
export interface DiscriminatorMapping {
  /** The discriminator property value (e.g. `"cat"`). */
  value: string;
  /** The name of the composed model this value selects (e.g. `"Cat"`). */
  modelName: string;
}

/**
 * The discriminator of a composite (`oneOf`/`anyOf`) or an inheritance base
 * (an `object` schema whose subtypes `allOf`-compose it), used to marshal
 * directly to the matching branch/subtype rather than merging every branch or
 * dropping subtype-only fields.
 */
export interface Discriminator {
  /** The wire property name carrying the discriminator value. */
  propertyName: string;
  /** The TypeScript property name (resolved during augmentation). */
  typescriptPropertyName?: string;
  /** The value → composed-model mapping. */
  mapping: DiscriminatorMapping[];
  /**
   * True when this discriminator sits on an inheritance base (an `object`
   * schema selected by `allOf`-composing subtypes) rather than a `oneOf`/
   * `anyOf` composite. The base marshals via dispatch to its subtypes, but its
   * subtypes compose the base's own (non-dispatching) body — so the base emits
   * a separate non-dispatching marshaller to break the recursion.
   */
  isBase?: boolean;
}

/** A pattern-property entry: a regex pattern and the model for its values. */
export interface PatternPropertyModel {
  pattern: string;
  model: Model;
}

/**
 * A model represents an OpenAPI schema, or something derived from one (a
 * property, parameter, or response). It is produced by the parser
 * (`../parser.ts`) and progressively augmented by `../codegen-data.ts` with
 * language-specific and code-generation fields before being handed to the
 * templates. Augmentation fields are optional as they are absent on raw parser
 * output.
 */
export interface Model {
  /** The schema, property, or parameter name. */
  name: string;
  /** How this model should be rendered. */
  export: ModelExport;
  /**
   * The model's type: a primitive name (`string`, `number`, `boolean`, `null`,
   * `void`, `binary`, `any`), `unknown`, or the name of a referenced model.
   */
  type: string;
  /** The OpenAPI `format` (e.g. `int32`, `date-time`, `binary`), if any. */
  format?: string;
  /** Description, used to render doc comments. */
  description: string | null;
  /** Whether the schema is marked deprecated. */
  deprecated: boolean;
  /** Whether the value may be null. */
  isNullable: boolean;
  /** Whether the property is read-only. */
  isReadOnly: boolean;
  /** Whether the property/parameter is required. */
  isRequired: boolean;
  /** Whether an array enforces uniqueness (rendered as a `Set`). */
  uniqueItems?: boolean;
  /** For arrays/dictionaries, the model describing the element/value type. */
  link?: Model | null;
  /** Child properties (for interfaces) or members (for composites). */
  properties: Model[];
  /** Enum members, when `export === 'enum'`. */
  enum: EnumMember[];
  /** Names of other models this model references (for import generation). */
  imports: string[];

  /** Where a parameter appears; `''` for non-parameter models. */
  in: ModelIn;
  /** The source property name for a parameter (body parameters use `body`). */
  prop?: string;
  /** The chosen request/response media type, for body params and responses. */
  mediaType?: string | null;
  /**
   * Per-part content types declared by the request body `encoding` object
   * (multipart bodies), keyed by property name.
   */
  partContentTypes?: { [prop: string]: string };
  /** All acceptable media types (request body / response). */
  mediaTypes?: string[];
  /** The response status code, for response models. */
  code?: number | string;

  /**
   * For a discriminated subtype's discriminator property: the rendered literal
   * TypeScript type (e.g. `'cat'`, or `'cat' | 'kitten'` when several values
   * map to one subtype) that makes the union a true tagged union. Absent when
   * the subtype's tag can't be pinned to a literal (e.g. it appears in
   * multiple unions with different values).
   */
  discriminatorValue?: string;

  /** The raw OpenAPI `type` (used to distinguish integer from number). */
  openapiType?: string | string[];
  /** Vendor extensions (`x-*`) copied from the schema. */
  vendorExtensions?: VendorExtensions;
  /** True when the schema has additionalProperties. */
  hasAdditionalProperties?: boolean;
  /** The model describing additionalProperties values. */
  additionalPropertiesModel?: Model;
  /** True when the schema has patternProperties. */
  hasPatternProperties?: boolean;
  /** The models describing each pattern's values. */
  patternPropertiesModels?: PatternPropertyModel[];

  /** For composites: the referenced (object) models composed together. */
  composedModels?: Model[];
  /** For composites: the primitive/enum/array members composed together. */
  composedPrimitives?: Model[];
  /** For discriminated one-of/any-of composites: the discriminator metadata. */
  discriminator?: Discriminator;

  /** The TypeScript identifier for this model/property. */
  typescriptName?: string;
  /** The rendered TypeScript type. */
  typescriptType?: string;
  /** The Python identifier for this model/property. */
  pythonName?: string;
  /** The rendered Python type. */
  pythonType?: string;
  /** snake_case model name (Python). */
  nameSnakeCase?: string;
  /** True when the model is a renderable primitive (not composite/collection). */
  isPrimitive?: boolean;
  /** True when the schema declares an enum. */
  isEnum?: boolean;

  /** True for JSON-lines streaming responses. */
  isJsonlStreaming?: boolean;
  /** The model describing each streamed item. */
  itemSchemaModel?: Model;

  /** Collection serialisation format for array query/header parameters. */
  collectionFormat?: CollectionFormat;
  /** Path parameter serialization style, when not the default `simple`. */
  pathStyle?: 'matrix' | 'label';
  /** Path parameter explode flag (used with `pathStyle`). */
  pathExplode?: boolean;
  /** Query parameter `allowReserved`: reserved characters are not encoded. */
  allowReserved?: boolean;
}

/** Vendor extension bag (`x-*` keys copied from a schema/operation/spec). */
export type VendorExtensions = { [key: string]: unknown };

/**
 * An operation represents a single OpenAPI path + method. Produced by the
 * parser and augmented by `../codegen-data.ts`.
 */
export interface Operation {
  id: string;
  name: string;
  method: string;
  path: string;
  description: string | null;
  tags?: string[] | null;
  deprecated: boolean;
  imports: string[];
  parameters: Model[];
  /** The request body parameter (same object reference as in `parameters`). */
  parametersBody?: Model | null;
  responses: Model[];

  /** Deduplicated operation name used throughout generated code. */
  uniqueName?: string;
  /** Dot-notation name (tag-qualified), used for metadata keys. */
  dotNotationName?: string;
  operationIdPascalCase?: string;
  operationIdSnakeCase?: string;
  /** The generated request type name (e.g. `FooRequest`). */
  requestTypeName?: string;

  /** The response model used as the operation's result. */
  result?: Model;

  /** The explicit body parameter when the body is not inlined. */
  explicitRequestBodyParameter?: Model;

  vendorExtensions?: VendorExtensions;
  isMutation?: boolean;
  isQuery?: boolean;
  isStreaming?: boolean;
  isInfiniteQuery?: boolean;
  /** The cursor parameter, for infinite queries. */
  infiniteQueryCursorProperty?: Model;
}

/**
 * A service groups operations. Currently the parser produces a single
 * `Default` service; operations are re-grouped by tag downstream.
 */
export interface Service {
  name: string;
  operations: Operation[];
  imports: string[];

  /** All model names the service (API client) needs to import. */
  modelImports?: string[];
  className?: string;
  nameSnakeCase?: string;
}

/**
 * The initial data structure produced by the OpenAPI parser.
 */
export interface ClientData {
  models: Model[];
  services: Service[];
}

/** Models indexed by name, for reference resolution during augmentation. */
export type ModelsByName = { [name: string]: Model };

/** Index a list of models by name. */
export const indexModelsByName = (models: Model[]): ModelsByName =>
  Object.fromEntries(models.map((m) => [m.name, m]));

/** The single service the parser emits; operations are re-grouped by tag. */
export const DEFAULT_SERVICE_NAME = 'Default';

/**
 * The full data structure handed to the code generation templates.
 */
export interface CodeGenData extends ClientData {
  className: string;
  info: OpenAPIV3.InfoObject | OpenAPIV3_1.InfoObject;
  allOperations: Operation[];
  operationsByTag: { [tag: string]: Operation[] };
  untaggedOperations: Operation[];
  vendorExtensions: VendorExtensions;
}

/**
 * Create a {@link Model} with the default fields the parser always emits.
 * Callers override the fields relevant to their specific schema.
 */
export const createModel = (overrides: Partial<Model> = {}): Model => ({
  name: '',
  export: 'interface',
  type: 'unknown',
  description: null,
  deprecated: false,
  isNullable: false,
  isReadOnly: false,
  isRequired: false,
  link: null,
  properties: [],
  enum: [],
  imports: [],
  in: '',
  ...overrides,
});

// Model types which indicate it is composed (ie inherits/mixin's another schema)
export const COMPOSED_SCHEMA_TYPES = new Set<ModelExport>([
  'one-of',
  'any-of',
  'all-of',
]);
export const COLLECTION_TYPES = new Set<ModelExport>(['array', 'dictionary']);
export const PRIMITIVE_TYPES = new Set([
  'string',
  'integer',
  'number',
  'boolean',
  'null',
  'any',
  'binary',
  'void',
]);

/**
 * Content types that indicate JSON Lines streaming (OpenAPI 3.2)
 */
export const STREAMING_CONTENT_TYPES = new Set([
  'application/jsonl',
  'application/x-ndjson',
]);

/**
 * Vendor extensions which are used to customise generated code
 */
export const VENDOR_EXTENSIONS = {
  /**
   * Set to 'true' to indicate this is a streaming API
   */
  STREAMING: 'x-streaming',
  /**
   * Set to true to indicate this is a mutation, regardless of its HTTP method
   */
  MUTATION: 'x-mutation',
  /**
   * Set to true to indicate this is a query, regardless of its HTTP method
   */
  QUERY: 'x-query',
  /**
   * Set to the name of the input property used as the cursor for pagination if
   * the API accepts a cursor that is not named 'cursor'.
   * This can also be set to false to override behaviour and indicate this is not
   * a paginated API.
   * Used for tanstack infinite query hooks.
   */
  CURSOR: 'x-cursor',
} as const;
