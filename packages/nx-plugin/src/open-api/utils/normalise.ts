/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import cloneDeepWith from 'lodash.clonedeepwith';
import type { OpenAPIV3 } from 'openapi-types';
import { isRef, resolveIfRef, resolveRef, splitRef } from './refs';
import { Spec } from './types';
import { pascalCase, upperFirst } from '../../utils/names';
import camelCase from 'lodash.camelcase';

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

const isCompositeSchema = (schema: OpenAPIV3.SchemaObject) =>
  !!schema.allOf || !!schema.anyOf || !!schema.oneOf;

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

const hoistInlineObjectSubSchemas = (
  nameParts: string[],
  schema: OpenAPIV3.SchemaObject,
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
    hoistInlineObjectSubSchemas(s.nameParts, s.schema),
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
      const name = s.nameParts.map(upperFirst).join('');
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
 * In order to ensure we generate models consistently whether or not users used refs or inline schemas,
 * we hoist any inline refs to non-primitives
 */
export const normaliseOpenApiSpecForCodeGen = (inSpec: Spec): Spec => {
  // Clone the spec so we're free to mutate it
  let spec = cloneDeepWith(inSpec);

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

        // Attempt to deduplicate the operationId by its tags
        if (duplicatedOperationIds.has(operationId)) {
          deduplicatedOpId = camelCase(
            tags.map((t) => `${t}-`).join('') + operationId,
          );
        }

        (operation as any)['x-aws-nx-deduplicated-op-id'] = deduplicatedOpId;

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
            const jsonResponseSchema =
              response?.content?.['application/json']?.schema;
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
              response!.content!['application/json'].schema = {
                $ref: `#/components/schemas/${schemaName}`,
              };
            }
          });
        }
        if ('requestBody' in operation) {
          const requestBody = resolveIfRef(spec, operation.requestBody);
          const jsonRequestSchema =
            requestBody?.content?.['application/json']?.schema;
          if (
            jsonRequestSchema &&
            !isRef(jsonRequestSchema) &&
            (['object', 'array'].includes(jsonRequestSchema.type!) ||
              isCompositeSchema(jsonRequestSchema) ||
              (jsonRequestSchema?.type === 'string' && jsonRequestSchema.enum))
          ) {
            const schemaName = `${upperFirst(deduplicatedOpId)}RequestContent`;
            spec.components!.schemas![schemaName] = jsonRequestSchema;
            requestBody!.content!['application/json'].schema = {
              $ref: `#/components/schemas/${schemaName}`,
            };
          }
        }
      }
    }),
  );

  // "Hoist" any nested object definitions in arrays/maps that aren't already refs, as parseOpenapi will treat the
  // type as "any" if they're defined inline (and not a ref)
  Object.entries(spec.components?.schemas ?? {}).forEach(([name, schema]) => {
    if (!isRef(schema)) {
      const refs = hoistInlineObjectSubSchemas([name], schema);
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
