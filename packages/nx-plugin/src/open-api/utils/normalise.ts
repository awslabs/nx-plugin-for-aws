/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import cloneDeepWith from 'lodash.clonedeepwith';
import type { OpenAPIV3 } from 'openapi-types';
import {
  camelCase,
  pascalCase,
  toClassName,
  upperFirst,
} from '../../utils/names';
import { STREAMING_CONTENT_TYPES } from './codegen-data/types';
import { isRef, resolveIfRef, resolveRef, splitRef } from './refs';
import type { Spec } from './types';

interface SubSchema {
  readonly nameParts: string[];
  readonly schema: OpenAPIV3.SchemaObject;
  readonly propPath: (string | number)[];
}

interface SubSchemaRef {
  readonly $ref: string;
  readonly name: string;
  readonly schema: OpenAPIV3.SchemaObject;
}

/**
 * Normalise schema names to valid TypeScript identifiers.
 * Converts names with hyphens or other invalid characters to PascalCase.
 * Throws an error if normalisation would create a name clash.
 */
const normaliseSchemaNames = (spec: Spec): Spec => {
  const schemaNameMapping: { [oldName: string]: string } = {};
  const originalNames = Object.keys(spec.components?.schemas ?? {});
  const existingSchemaNames = new Set(originalNames);

  // The name each schema resolves to (its normalised form, or itself when it
  // needs no normalisation). Used to detect two distinct schemas that would
  // collapse onto the same identifier.
  const resolvedNameOwners: { [resolvedName: string]: string } = {};

  // Build mapping of old names to new names
  originalNames.forEach((name) => {
    const normalizedName = toClassName(name);
    if (normalizedName !== name) {
      // Check if the normalized name would clash with an existing schema
      if (existingSchemaNames.has(normalizedName)) {
        throw new Error(
          `Schema name normalization conflict: "${name}" would be normalized to "${normalizedName}", but a schema with that name already exists. Please rename one of these schemas in your OpenAPI specification.`,
        );
      }
      schemaNameMapping[name] = normalizedName;
    }

    // Detect two distinct schemas resolving to the same name (e.g. "Foo-Bar"
    // and "Foo.Bar" both normalise to "FooBar"), which would otherwise
    // silently overwrite one another.
    const owner = resolvedNameOwners[normalizedName];
    if (owner !== undefined) {
      throw new Error(
        `Schema name normalization conflict: "${name}" and "${owner}" both normalize to "${normalizedName}". Please rename one of these schemas in your OpenAPI specification.`,
      );
    }
    resolvedNameOwners[normalizedName] = name;
  });

  // If no normalization needed, return spec as-is
  if (Object.keys(schemaNameMapping).length === 0) {
    return spec;
  }

  // Update all $ref references throughout the spec
  spec = cloneDeepWith(spec, (v) => {
    if (isRef(v)) {
      const parts = splitRef(v.$ref);
      if (
        parts.length === 3 &&
        parts[0] === 'components' &&
        parts[1] === 'schemas'
      ) {
        const oldName = parts[2];
        const newName = schemaNameMapping[oldName];
        if (newName) {
          return { $ref: `#/components/schemas/${newName}` };
        }
      }
    }
  });

  // Rename schema keys, recording the original name so downstream code can
  // recover the on-the-wire value (e.g. an implicit discriminator matches on
  // the original schema name, not its normalised identifier).
  Object.entries(schemaNameMapping).forEach(([oldName, newName]) => {
    const schema = spec.components!.schemas![oldName];
    if (schema && !isRef(schema)) {
      (schema as { 'x-aws-nx-original-name'?: string })[
        'x-aws-nx-original-name'
      ] = oldName;
    }
    spec.components!.schemas![newName] = schema;
    delete spec.components!.schemas![oldName];
  });

  return spec;
};

const isCompositeSchema = (schema: OpenAPIV3.SchemaObject) =>
  !!schema.allOf || !!schema.anyOf || !!schema.oneOf;

/**
 * The media type whose schema is hoisted for a request/response: prefer
 * `application/json`, falling back to any `+json` vendored type (e.g.
 * `application/problem+json`).
 */
const preferredJsonMediaType = (mediaTypes: string[]): string | undefined =>
  mediaTypes.find((mediaType) => mediaType === 'application/json') ??
  mediaTypes.find((mediaType) => mediaType.split(';')[0].endsWith('+json'));

const hasSubSchemasToVisit = (
  schema?: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
): schema is OpenAPIV3.SchemaObject =>
  !!schema &&
  !isRef(schema) &&
  (['object', 'array'].includes(schema.type as any) ||
    isCompositeSchema(schema) ||
    !!schema.not ||
    (schema.type === 'string' && !!schema.enum));

const filterInlineCompositeSchemas = (
  schemas: (OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject)[],
  nameParts: string[],
  namePartPrefix: string,
  propPath: (string | number)[],
): SubSchema[] => {
  let inlineSchemaIndex = 0;
  return schemas.flatMap((s, i) => {
    if (hasSubSchemasToVisit(s)) {
      const subSchema: SubSchema = {
        nameParts: s.title
          ? [pascalCase(s.title)]
          : [
              ...nameParts,
              `${namePartPrefix}${inlineSchemaIndex === 0 ? '' : inlineSchemaIndex}`,
            ],
        schema: s,
        propPath: [...propPath, i],
      };
      inlineSchemaIndex++;
      return [subSchema];
    }
    return [];
  });
};

/**
 * Returns a unique model/schema name for any models which we hoist
 */
const createUniqueModelName = (
  nameParts: string[],
  seenModelNameCounts: { [name: string]: number },
): string => {
  // Normalise each part to a class-name form (stripping `_`, hyphens, etc) so
  // the hoisted schema name matches what `toTypeScriptModelName`/`toClassName`
  // later derive — otherwise a part like `store_photos` yields a `Store_photos`
  // schema whose reference (`StorePhotos`) no longer resolves.
  const candidateName = nameParts.map(toClassName).join('');

  const seenModelNameCount = seenModelNameCounts[candidateName];

  // We have not seen this name so we're free to use it
  if (seenModelNameCount === undefined) {
    seenModelNameCounts[candidateName] = 1;
    return candidateName;
  }

  // We have seen the name before, so we must disambiguate
  seenModelNameCounts[candidateName]++;
  return `${candidateName}${seenModelNameCount}`;
};

const hoistInlineObjectSubSchemas = (
  nameParts: string[],
  schema: OpenAPIV3.SchemaObject,
  seenModelNameCounts: { [name: string]: number },
): SubSchemaRef[] => {
  // Find all the inline subschemas we should visit
  const inlineSubSchemas: SubSchema[] = [
    ...(hasSubSchemasToVisit(schema.not)
      ? [
          {
            nameParts: schema.not?.title
              ? [pascalCase(schema.not?.title)]
              : [...nameParts, 'Not'],
            schema: schema.not,
            propPath: ['not'],
          },
        ]
      : []),
    ...(schema.anyOf
      ? filterInlineCompositeSchemas(schema.anyOf, nameParts, 'AnyOf', [
          'anyOf',
        ])
      : []),
    ...(schema.allOf
      ? filterInlineCompositeSchemas(schema.allOf, nameParts, 'AllOf', [
          'allOf',
        ])
      : []),
    ...(schema.oneOf
      ? filterInlineCompositeSchemas(schema.oneOf, nameParts, 'OneOf', [
          'oneOf',
        ])
      : []),
    ...('items' in schema && hasSubSchemasToVisit(schema.items)
      ? [
          {
            nameParts: schema.items?.title
              ? [pascalCase(schema.items?.title)]
              : [...nameParts, 'Item'],
            schema: schema.items,
            propPath: ['items'],
          },
        ]
      : []),
    ...Object.entries(schema.properties ?? {})
      .filter(([, s]) => hasSubSchemasToVisit(s))
      .map(([name, s]) => ({
        nameParts: (s as OpenAPIV3.SchemaObject).title
          ? [pascalCase((s as OpenAPIV3.SchemaObject).title)]
          : [...nameParts, name],
        schema: s as OpenAPIV3.SchemaObject,
        propPath: ['properties', name],
      })),
    ...(typeof schema.additionalProperties !== 'boolean' &&
    hasSubSchemasToVisit(schema.additionalProperties)
      ? [
          {
            nameParts: schema.additionalProperties?.title
              ? [pascalCase(schema.additionalProperties?.title)]
              : [...nameParts, 'Value'],
            schema: schema.additionalProperties,
            propPath: ['additionalProperties'],
          },
        ]
      : []),
    ...Object.entries((schema as any).patternProperties ?? {})
      .filter(([, s]) => hasSubSchemasToVisit(s))
      .map(([pattern, s], i) => ({
        nameParts: (s as OpenAPIV3.SchemaObject).title
          ? [pascalCase((s as OpenAPIV3.SchemaObject).title)]
          : [...nameParts, pascalCase(pattern), `${i}`],
        schema: s as OpenAPIV3.SchemaObject,
        propPath: ['patternProperties', pattern],
      })),
  ];

  // Hoist these recursively first (ie depth first search) so that we don't miss refs
  const recursiveRefs = inlineSubSchemas.flatMap((s) =>
    hoistInlineObjectSubSchemas(s.nameParts, s.schema, seenModelNameCounts),
  );

  // Clone the object subschemas to build the refs. Note that only objects with "properties" are hoisted as these are non-dictionary types
  const refs = inlineSubSchemas
    .filter(
      (s) =>
        (s.schema.type === 'object' && s.schema.properties) ||
        isCompositeSchema(s.schema) ||
        (s.schema.type === 'object' && (s.schema as any).patternProperties) ||
        (s.schema.type === 'string' && s.schema.enum),
    )
    .map((s) => {
      const name = createUniqueModelName(s.nameParts, seenModelNameCounts);

      const $ref = `#/components/schemas/${name}`;
      const ref = {
        $ref,
        name,
        schema: structuredClone({
          ...s.schema,
          'x-aws-nx-hoisted': true,
        }),
      };

      // Replace each subschema with a ref in the spec
      const schemaWithPropToReplace = s.propPath
        .slice(0, -1)
        .reduce(
          (resolvedInSchema, pathPart) => resolvedInSchema?.[pathPart],
          schema,
        );
      if (schemaWithPropToReplace) {
        schemaWithPropToReplace[s.propPath[s.propPath.length - 1]] = { $ref };
      }

      return ref;
    });

  return [...refs, ...recursiveRefs];
};

/**
 * Rewrites OpenAPI 3.1 `const` schemas to the semantically equivalent `enum`
 * form. FastAPI emits `{type: 'string', const: 'X'}` for `Literal['X']`; the
 * parser understands the enum shape, whereas the const shape would synthesise
 * phantom named references.
 */
const rewriteConstToEnum = (spec: Spec): Spec => {
  const rewrite = (v: any): any => {
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      'const' in v &&
      !('enum' in v)
    ) {
      const { const: constValue, ...rest } = v;
      // Recurse with the same rewrite so consts nested within a rewritten
      // schema are also rewritten.
      return cloneDeepWith({ ...rest, enum: [constValue] }, rewrite);
    }
  };
  return cloneDeepWith(spec, rewrite);
};

/**
 * Rewrites a composite schema with sibling `properties`/`required` (a valid
 * JSON Schema conjunction, common in FastAPI/Pydantic output) into an
 * equivalent extra `allOf` member, so the parser sees a pure composite and the
 * sibling fields are neither dropped from the type nor stripped when
 * marshalling.
 */
const rewriteCompositeSiblingProperties = (spec: Spec): Spec => {
  const rewrite = (v: any): any => {
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      Array.isArray(v.allOf) &&
      v.properties
    ) {
      const { properties, required, type: _type, ...rest } = v;
      return cloneDeepWith(
        {
          ...rest,
          allOf: [
            ...v.allOf,
            {
              type: 'object',
              properties,
              ...(required ? { required } : {}),
            },
          ],
        },
        rewrite,
      );
    }
  };
  return cloneDeepWith(spec, rewrite);
};

/**
 * Rewrites an OpenAPI 3.1 multi-type schema (`type: ['integer', 'string']`)
 * into the equivalent `anyOf` of single-type schemas, dropping `null` from the
 * list and marking the schema nullable instead. This lets the parser render a
 * proper union rather than collapsing to the first declared type.
 */
const rewriteMultiTypeToAnyOf = (spec: Spec): Spec => {
  const rewrite = (v: any): any => {
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      Array.isArray(v.type) &&
      !('anyOf' in v) &&
      !('oneOf' in v) &&
      !('allOf' in v) &&
      !('enum' in v)
    ) {
      const { type, nullable, ...rest } = v;
      const nonNull = (type as string[]).filter((t) => t !== 'null');
      const isNullable = nullable === true || nonNull.length !== type.length;
      // Recurse with the same rewrite so multi-type schemas nested within a
      // rewritten schema (e.g. the items of a nullable array) are also
      // rewritten.
      // A single non-null type is not a union; keep it as a plain typed schema.
      if (nonNull.length <= 1) {
        return cloneDeepWith(
          {
            ...rest,
            ...(nonNull.length === 1 ? { type: nonNull[0] } : {}),
            ...(isNullable ? { nullable: true } : {}),
          },
          rewrite,
        );
      }
      return cloneDeepWith(
        {
          ...rest,
          anyOf: nonNull.map((t) => ({ type: t })),
          ...(isNullable ? { nullable: true } : {}),
        },
        rewrite,
      );
    }
  };
  return cloneDeepWith(spec, rewrite);
};

/**
 * Inlines `$ref` path items so that every operation is visited by the
 * normalisation below (operationId assignment, schema hoisting). Each path
 * gets its own copy, so paths sharing a path item are normalised
 * independently.
 */
const inlinePathItemRefs = (spec: Spec): void => {
  Object.entries(spec.paths ?? {}).forEach(([path, pathItem]) => {
    if (isRef(pathItem)) {
      const { $ref, ...rest } = pathItem;
      spec.paths![path] = {
        ...structuredClone(resolveRef(spec, $ref)),
        ...rest,
      };
    }
  });
};

/**
 * In order to ensure we generate models consistently whether or not users used refs or inline schemas,
 * we hoist any inline refs to non-primitives
 */
export const normaliseOpenApiSpecForCodeGen = (inSpec: Spec): Spec => {
  // Clone the spec so we're free to mutate it
  let spec = cloneDeepWith(inSpec);

  inlinePathItemRefs(spec);
  spec = rewriteConstToEnum(spec);
  spec = rewriteMultiTypeToAnyOf(spec);
  spec = rewriteCompositeSiblingProperties(spec);

  // Ensure spec has schemas set
  if (!spec?.components?.schemas) {
    spec.components = {
      ...spec.components,
    };
    spec.components.schemas = {
      ...spec.components.schemas,
    };
  }

  const seenOperationIds = new Set<string>();
  const duplicatedOperationIds = new Set<string>();

  // Make sure all operationIds are camelCase, and find which ones are duplicated
  Object.entries(spec.paths ?? {}).forEach(([path, pathOps]) =>
    Object.entries(pathOps ?? {}).forEach(([method, op]) => {
      const operation = resolveIfRef(spec, op);
      if (operation && typeof operation === 'object') {
        const operationId = camelCase(
          (operation as any).operationId ?? `${method}-${path}`,
        );
        (operation as any).operationId = operationId;
        if (seenOperationIds.has(operationId)) {
          duplicatedOperationIds.add(operationId);
        }
        seenOperationIds.add(operationId);
      }
    }),
  );

  // Reset seen operation ids
  seenOperationIds.clear();

  const untagged = Symbol('untagged');
  const seenOperationIdsByTag: { [tag: string | symbol]: Set<string> } = {};

  // "Hoist" inline request and response schemas
  Object.entries(spec.paths ?? {}).forEach(([path, pathOps]) =>
    Object.entries(pathOps ?? {}).forEach(([method, op]) => {
      const operation = resolveIfRef(spec, op);
      if (operation && typeof operation === 'object') {
        const tags: string[] = (operation as any).tags ?? [];
        const operationId = (operation as any).operationId as string;

        // Allow operations to have the same id
        let deduplicatedOpId = operationId;
        let deduplicatedDotNotationOpId = operationId;

        // Attempt to deduplicate the operationId by its tags
        if (duplicatedOperationIds.has(operationId)) {
          deduplicatedOpId = camelCase(
            tags.map((t) => `${t}-`).join('') + operationId,
          );
          deduplicatedDotNotationOpId =
            tags.map((t) => `${camelCase(t)}.`).join('') +
            camelCase(operationId);
        }

        (operation as any)['x-aws-nx-deduplicated-op-id'] = deduplicatedOpId;
        (operation as any)['x-aws-nx-deduplicated-dot-op-id'] =
          deduplicatedDotNotationOpId;

        seenOperationIds.add(deduplicatedOpId);

        // Throw an error for any duplicated operation ids with the same tag, or untagged
        [...(tags.length === 0 ? [untagged] : tags)].forEach((tag) => {
          if (
            seenOperationIdsByTag[tag] &&
            seenOperationIdsByTag[tag].has(operationId)
          ) {
            throw new Error(
              tag === untagged
                ? `Untagged operations cannot have the same operationId (${operationId})`
                : `Operations with the same tag (${String(tag)}) cannot have the same operationId (${operationId})`,
            );
          }

          seenOperationIdsByTag[tag] = new Set([
            ...(seenOperationIdsByTag[tag] ?? []),
            operationId,
          ]);
        });

        if ('responses' in operation) {
          Object.entries(operation.responses ?? {}).forEach(([code, res]) => {
            const response = resolveIfRef(spec, res);
            const jsonMediaType = preferredJsonMediaType(
              Object.keys(response?.content ?? {}),
            );
            const jsonResponseSchema = jsonMediaType
              ? response!.content![jsonMediaType].schema
              : undefined;
            if (
              jsonResponseSchema &&
              !isRef(jsonResponseSchema) &&
              (['object', 'array'].includes(jsonResponseSchema.type!) ||
                isCompositeSchema(jsonResponseSchema) ||
                (jsonResponseSchema?.type === 'string' &&
                  jsonResponseSchema.enum))
            ) {
              const schemaName = `${upperFirst(deduplicatedOpId)}${code}Response`;
              spec.components!.schemas![schemaName] = jsonResponseSchema;
              response!.content![jsonMediaType!].schema = {
                $ref: `#/components/schemas/${schemaName}`,
              };
            }

            // Hoist inline streaming item schemas (OpenAPI 3.2 itemSchema) so
            // each streamed item gets a named model.
            STREAMING_CONTENT_TYPES.forEach((mediaType) => {
              const streamingContent = response?.content?.[mediaType] as
                | { itemSchema?: OpenAPIV3.SchemaObject }
                | undefined;
              const itemSchema = streamingContent?.itemSchema;
              if (
                itemSchema &&
                !isRef(itemSchema) &&
                (['object', 'array'].includes(itemSchema.type!) ||
                  isCompositeSchema(itemSchema) ||
                  (itemSchema.type === 'string' && itemSchema.enum))
              ) {
                const schemaName = `${upperFirst(deduplicatedOpId)}${code}ResponseItem`;
                spec.components!.schemas![schemaName] = itemSchema;
                streamingContent.itemSchema = {
                  $ref: `#/components/schemas/${schemaName}`,
                } as OpenAPIV3.SchemaObject;
              }
            });
          });
        }
        if ('requestBody' in operation) {
          const requestBody = resolveIfRef(spec, operation.requestBody);
          const contentMediaTypes = Object.keys(requestBody?.content ?? {});
          // Hoist the JSON body, falling back to a form-data body (multipart or
          // urlencoded) so an inline form object is fully typed and marshalled
          // rather than left `unknown`.
          const bodyMediaType =
            preferredJsonMediaType(contentMediaTypes) ??
            contentMediaTypes.find((mt) =>
              [
                'multipart/form-data',
                'application/x-www-form-urlencoded',
              ].includes(mt.split(';')[0]),
            );
          const bodyRequestSchema = bodyMediaType
            ? requestBody!.content![bodyMediaType].schema
            : undefined;
          if (
            bodyRequestSchema &&
            !isRef(bodyRequestSchema) &&
            (['object', 'array'].includes(bodyRequestSchema.type!) ||
              isCompositeSchema(bodyRequestSchema) ||
              (bodyRequestSchema?.type === 'string' && bodyRequestSchema.enum))
          ) {
            const schemaName = `${upperFirst(deduplicatedOpId)}RequestContent`;
            spec.components!.schemas![schemaName] = bodyRequestSchema;
            requestBody!.content![bodyMediaType!].schema = {
              $ref: `#/components/schemas/${schemaName}`,
            };
          }
        }

        // Hoist parameter schemas. Composite and inline-object schemas are
        // hoisted to named models so the parameter is fully typed (e.g. a
        // `deepObject` query param's members are marshalled, not left `unknown`).
        if ('parameters' in operation) {
          (operation.parameters ?? []).forEach((p) => {
            const param = resolveIfRef(spec, p);
            const paramSchema = param?.schema as
              | OpenAPIV3.SchemaObject
              | undefined;
            if (
              paramSchema &&
              !isRef(paramSchema) &&
              (isCompositeSchema(paramSchema) ||
                (paramSchema.type === 'object' && !!paramSchema.properties))
            ) {
              const schemaName = `${upperFirst(deduplicatedOpId)}Request${upperFirst(param.in)}${upperFirst(camelCase(param.name))}`;
              spec.components!.schemas![schemaName] = paramSchema;
              param.schema = { $ref: `#/components/schemas/${schemaName}` };
            }
          });
        }
      }
    }),
  );

  // Normalize schema names to valid TypeScript identifiers (e.g., "Message-Output" -> "MessageOutput")
  spec = normaliseSchemaNames(spec);

  // Initialise the models that we have seen with all schemas.
  // This is required to ensure we do not create any clashing models below
  const seenModelNameCounts = Object.fromEntries(
    Object.keys(spec.components?.schemas ?? {}).map((name) => [name, 1]),
  );

  // "Hoist" any nested object definitions in arrays/maps that aren't already refs, as parseOpenapi will treat the
  // type as "any" if they're defined inline (and not a ref)
  Object.entries(spec.components?.schemas ?? {}).forEach(([name, schema]) => {
    if (!isRef(schema)) {
      const refs = hoistInlineObjectSubSchemas(
        [name],
        schema,
        seenModelNameCounts,
      );
      refs.forEach((ref) => {
        spec.components!.schemas![ref.name] = ref.schema;
      });
    }
  });

  // "Inline" any refs to non objects/enums
  const inlinedRefs: Set<string> = new Set();
  spec = cloneDeepWith(spec, (v) => {
    if (v && typeof v === 'object' && v.$ref) {
      const resolved = resolveRef(spec, v.$ref);
      if (
        resolved &&
        resolved.type &&
        resolved.type !== 'object' &&
        !(resolved.type === 'string' && resolved.enum)
      ) {
        inlinedRefs.add(v.$ref);
        return resolved;
      }
    }
  });

  // Delete the non object schemas that were inlined
  [...inlinedRefs].forEach((ref) => {
    const parts = splitRef(ref);
    if (
      parts.length === 3 &&
      parts[0] === 'components' &&
      parts[1] === 'schemas'
    ) {
      delete spec.components!.schemas![parts[2]];
    }
  });

  return spec;
};
