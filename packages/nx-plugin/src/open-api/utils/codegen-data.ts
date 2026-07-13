/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import orderBy from 'lodash.orderby';
import trim from 'lodash.trim';
import uniqBy from 'lodash.uniqby';
import type { OpenAPIV3 } from 'openapi-types';
import {
  camelCase,
  pascalCase,
  snakeCase,
  toClassName,
  upperFirst,
} from '../../utils/names';
import {
  qualifyPythonType,
  toPythonAnnotation,
  toPythonClassName,
  toPythonName,
  toPythonType,
  toTypeScriptModelName,
  toTypeScriptName,
  toTypeScriptType,
} from './codegen-data/languages';
import {
  COLLECTION_TYPES,
  COMPOSED_SCHEMA_TYPES,
  type CodeGenData,
  type CollectionFormat,
  createModel,
  DEFAULT_SERVICE_NAME,
  type ErrorShape,
  indexModelsByName,
  type Model,
  type ModelsByName,
  type Operation,
  type PatternPropertyModel,
  PRIMITIVE_TYPES,
  type RequestInput,
  type RequestShape,
  type Service,
  STREAMING_CONTENT_TYPES,
  VENDOR_EXTENSIONS,
  type VendorExtensions,
} from './codegen-data/types';
import { normaliseOpenApiSpecForCodeGen } from './normalise';
import {
  buildClientData,
  buildInlineModel,
  compositeMemberSchemas,
  getSpecOperation,
  getSpecParametersByKey,
  getSpecPathParameters,
  linkModel,
  specParameterKey,
} from './parser';
import { isRef, resolveIfRef, splitRef } from './refs';
import type { OpenApiSchema, OpenApiSchemaOrRef, Spec } from './types';

/**
 * Build the data structure used to generate code from an OpenAPI spec.
 */
export const buildOpenApiCodeGenData = (inSpec: Spec): CodeGenData => {
  const spec = normaliseOpenApiSpecForCodeGen(inSpec);
  const data = buildClientData(spec);

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

  for (const model of data.models) {
    assertNoClashingPropertyNames(model);
    assertNoConflictingUnionMemberMarshalling(model);
  }

  for (const op of allOperations) {
    assertEncodableUrlEncodedBody(op);
  }

  data.models = orderBy(data.models, (d) => d.name);
  // Default service first, then by name.
  data.services = orderBy(data.services, (s) =>
    s.name === DEFAULT_SERVICE_NAME ? '' : s.name,
  );

  const { operationsByTag, untaggedOperations } =
    groupOperationsByTag(allOperations);

  annotateAllOfFlattening(data.models);
  for (const op of allOperations) {
    annotateRequestAndErrorShapes(op, modelsByName);
  }

  const result: CodeGenData = {
    ...data,
    operationsByTag,
    untaggedOperations,
    info: spec.info,
    allOperations,
    vendorExtensions: vendorExtensionsOf(spec),
    className: toClassName(spec.info.title),
  };

  // Final pass to derive python-specific fields now that all links and
  // composite relationships are resolved. Produced once so every downstream
  // language generator consumes a single prepared object.
  annotatePythonData(result, modelsByName);

  return result;
};

/**
 * For each `all-of` composite: precompute the flat property list templates
 * that flatten composition will emit (`effectiveProperties`), and mark
 * hoisted (normaliser-synthesised) components the parent inlines
 * (`isInlinedByAllOf`) so templates can skip emitting them separately.
 */
const annotateAllOfFlattening = (models: Model[]): void => {
  for (const model of models) {
    if (model.export !== 'all-of') continue;
    const flattened: Model[] = [];
    const seen = new Set<string>();
    for (const composed of model.composedModels ?? []) {
      if (composed.vendorExtensions?.['x-aws-nx-hoisted']) {
        composed.isInlinedByAllOf = model.name;
      }
      for (const prop of composed.properties ?? []) {
        if (!prop.name || seen.has(prop.name)) continue;
        seen.add(prop.name);
        flattened.push(prop);
      }
    }
    model.effectiveProperties = flattened;
  }
};

/**
 * The object-shaped properties a body model exposes for flattening, walking
 * allOf composition via `effectiveProperties` when present.
 */
const flattenableBodyProperties = (bodyModel: Model | undefined): Model[] => {
  if (!bodyModel) return [];
  if (bodyModel.export === 'interface' && !bodyModel.hasAdditionalProperties) {
    return bodyModel.properties ?? [];
  }
  if (bodyModel.export === 'all-of') {
    return bodyModel.effectiveProperties ?? [];
  }
  return [];
};

/**
 * Whether a body's fields can be flattened into the call signature without
 * clashing with path/query/header/cookie parameters. Only object-shaped
 * bodies (references to an interface or allOf) are eligible; discriminated
 * bases stay whole so marshalling can dispatch on the discriminator.
 */
const canFlattenBodyIntoRequest = (
  op: Operation,
  bodyParam: Model | undefined,
  bodyModel: Model | undefined,
): boolean => {
  if (!bodyParam || bodyParam.export !== 'reference') return false;
  if (bodyModel?.discriminator) return false;
  const props = flattenableBodyProperties(bodyModel);
  if (props.length === 0) return false;
  const otherNames = new Set(
    (op.parameters ?? []).filter((p) => p.in !== 'body').map((p) => p.name),
  );
  return props.every((prop) => !otherNames.has(prop.name));
};

/**
 * Expand a status-code range spec ("2XX", "5XX", etc.) to the concrete list
 * of integer codes it covers. Returns `undefined` for `'default'` (any
 * non-matched code) and `[code]` for a literal numeric code.
 */
const statusCodesFor = (code: number | string): number[] | undefined => {
  if (typeof code === 'number') return [code];
  if (/^\dXX$/.test(code)) {
    const base = Number(code.charAt(0)) * 100;
    return Array.from({ length: 100 }, (_, i) => base + i);
  }
  return undefined;
};

/**
 * Build a language-agnostic description of an operation's inputs. Each input
 * carries its source (where in the HTTP request it is placed) plus the
 * underlying model — language templates decide how to translate that into
 * their idiomatic call signature (kwargs, a wrapper interface, etc).
 */
const buildRequestShape = (
  op: Operation,
  modelsByName: ModelsByName,
): RequestShape => {
  const nonBody = (op.parameters ?? []).filter((p) => p.in !== 'body');
  const inputs: RequestInput[] = nonBody.map((p) => ({
    source: {
      kind: p.in as 'path' | 'query' | 'header' | 'cookie',
      wireName: p.prop ?? p.name,
      ...(p.collectionFormat ? { collectionFormat: p.collectionFormat } : {}),
    },
    model: p,
    fromFlattenedBody: false,
    isRequired: !!p.isRequired,
    isNullable: !!p.isNullable,
    description: p.description,
    specName: p.prop ?? p.name,
  }));

  const shape: RequestShape = { inputs, isSingleBodyInput: false };
  const bodyParam = op.parametersBody ?? undefined;
  if (bodyParam) {
    const mediaType =
      bodyParam.mediaType ??
      (bodyParam.mediaTypes ? bodyParam.mediaTypes[0] : undefined) ??
      undefined;
    const bodyModel = modelsByName[bodyParam.type];
    if (canFlattenBodyIntoRequest(op, bodyParam, bodyModel)) {
      for (const prop of flattenableBodyProperties(bodyModel)) {
        inputs.push({
          source: { kind: 'body-field', fieldName: prop.name },
          model: prop,
          fromFlattenedBody: true,
          isRequired: !!prop.isRequired,
          isNullable: !!prop.isNullable,
          description: prop.description,
          specName: prop.name,
        });
      }
      shape.bodyFromFields = { model: bodyModel, mediaType };
    } else {
      inputs.push({
        source: { kind: 'body', wireName: 'body' },
        model: bodyParam,
        fromFlattenedBody: false,
        isRequired: !!bodyParam.isRequired,
        isNullable: !!bodyParam.isNullable,
        description: bodyParam.description,
        specName: 'body',
      });
      shape.bodyAsSingleInput = { model: bodyParam, mediaType };
      if (nonBody.length === 0) shape.isSingleBodyInput = true;
    }
  }
  return shape;
};

/**
 * Build a language-agnostic error taxonomy for the operation: one entry per
 * non-success response bucket. Language templates turn these into typed
 * exception / error union shapes as appropriate.
 */
const buildErrorShape = (op: Operation): ErrorShape => ({
  entries: (op.responses ?? [])
    .filter((r) => r.code !== op.result?.code)
    .map((resp) => ({
      code: resp.code!,
      statusCodes: statusCodesFor(resp.code!),
      responseModel: resp,
    })),
});

/**
 * Annotate a typed entry (response, parameter, result) with whether the type
 * it references resolves to a module-level alias — a collection
 * (`list[...]` / `dict[str, ...]`), union or literal — rather than a class.
 * Python templates read `referencedCollectionKind` to pick pydantic's
 * `TypeAdapter(X)` over `X.model_validate(...)`.
 */
const annotateReferencedCollectionKind = (
  entry: Model | undefined,
  modelsByName: ModelsByName,
): void => {
  if (!entry?.type) return;
  const referenced = modelsByName[entry.type];
  if (!referenced) return;
  if (referenced.export === 'dictionary') {
    entry.referencedCollectionKind = 'dictionary';
  } else if (referenced.export === 'array') {
    entry.referencedCollectionKind = 'array';
  } else if (
    referenced.export === 'one-of' ||
    referenced.export === 'any-of' ||
    referenced.export === 'enum' ||
    referenced.export === 'tuple'
  ) {
    entry.referencedCollectionKind = 'alias';
  }
};

/**
 * Attach the request shape, error shape and referenced-collection-kind
 * annotations to an operation.
 */
const annotateRequestAndErrorShapes = (
  op: Operation,
  modelsByName: ModelsByName,
): void => {
  for (const parameter of op.parameters ?? []) {
    annotateReferencedCollectionKind(parameter, modelsByName);
  }
  annotateReferencedCollectionKind(op.parametersBody ?? undefined, modelsByName);
  for (const response of op.responses ?? []) {
    annotateReferencedCollectionKind(response, modelsByName);
  }
  annotateReferencedCollectionKind(op.result, modelsByName);

  op.requestShape = buildRequestShape(op, modelsByName);
  op.errorShape = buildErrorShape(op);
};

const TYPES_GEN_PREFIX = 'types_gen.';

/**
 * Attach `pythonClientType` to a typed entry — the bare `pythonType`
 * qualified with `types_gen.` so client templates can reference model
 * classes through a single import.
 */
const annotatePythonClientType = (entry: Model | undefined): void => {
  if (!entry) return;
  entry.pythonClientType = qualifyPythonType(
    entry.pythonType || entry.type,
    TYPES_GEN_PREFIX,
  );
};

/**
 * Final pass over all models + operation payloads to re-derive python type
 * annotations after links/composites are resolved, and to add the
 * python-specific annotations the py-client templates consume:
 *  - `pythonType` / `pythonAnnotation` (refreshed — necessary for collection
 *    aliases whose element type wasn't available first time through)
 *  - `pythonClassName` / `pythonClientType`
 *  - `requestShape.inputs[*].pythonName` / `.pythonAnnotation` (kwargs)
 *  - `errorShape.exceptionClassName` / `.unionTypeName` / per-entry names
 *
 * Runs for every spec — the resulting fields are only read by the py-client
 * templates, so there's no cost to TypeScript consumers.
 */
const annotatePythonData = (
  data: CodeGenData,
  modelsByName: ModelsByName,
): void => {
  for (const model of data.models) {
    model.pythonClassName = toPythonClassName(model.name);
    model.pythonType = toPythonType(model);
    model.pythonAnnotation = toPythonAnnotation(model);
    annotatePythonClientType(model);
    for (const prop of model.properties ?? []) {
      prop.pythonType = toPythonType(prop);
      prop.pythonAnnotation = toPythonAnnotation(prop);
      annotatePythonClientType(prop);
    }
    for (const prop of model.effectiveProperties ?? []) {
      prop.pythonType = toPythonType(prop);
      prop.pythonAnnotation = toPythonAnnotation(prop);
      annotatePythonClientType(prop);
    }
    annotatePythonClientType(model.additionalPropertiesModel);
  }

  for (const op of data.allOperations) {
    for (const parameter of op.parameters ?? []) {
      parameter.pythonType = toPythonType(parameter);
      parameter.pythonAnnotation = toPythonAnnotation(parameter);
      annotatePythonClientType(parameter);
    }
    annotatePythonClientType(op.parametersBody ?? undefined);
    annotatePythonClientType(op.result);
    for (const response of op.responses ?? []) {
      annotatePythonClientType(response);
      annotatePythonClientType(response.itemSchemaModel);
    }

    const requestShape = op.requestShape;
    if (requestShape) {
      const seenNames = new Set<string>();
      for (const input of requestShape.inputs) {
        const rawName = input.model.pythonName || input.specName;
        let pythonName = toPythonName('property', rawName);
        if (seenNames.has(pythonName)) {
          pythonName = `${pythonName}_${input.source.kind.replace('-', '_')}`;
        }
        seenNames.add(pythonName);
        const baseType = qualifyPythonType(
          input.model.pythonType || input.model.type,
          TYPES_GEN_PREFIX,
        );
        input.pythonName = pythonName;
        input.pythonAnnotation =
          input.isRequired && !input.isNullable
            ? baseType
            : `Optional[${baseType}]`;
      }
      // Required-first so the generated keyword-only signature reads naturally.
      requestShape.inputs.sort(
        (a, b) => Number(b.isRequired) - Number(a.isRequired),
      );
    }

    const errorShape = op.errorShape;
    if (errorShape) {
      const opPascal = op.operationIdPascalCase!;
      errorShape.exceptionClassName = `${opPascal}ApiError`;
      errorShape.unionTypeName =
        errorShape.entries.length > 0 ? `${opPascal}Error` : 'Never';
      for (const entry of errorShape.entries) {
        const suffix =
          entry.code === 'default'
            ? 'Default'
            : String(entry.code).toUpperCase();
        entry.className = `${opPascal}${suffix}Error`;
        entry.isExactCode = typeof entry.code === 'number';
        // Only collapse to a Literal for exact numeric codes — ranges like
        // 5XX expand to 100 codes, which produce a massive, unreadable
        // Literal and don't narrow `response.status_code` usefully anyway.
        entry.statusAnnotation = entry.isExactCode
          ? `Literal[${entry.code}]`
          : 'int';
      }
    }
  }
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
      const responseContent = specResponse.content[mediaType];
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
  const specParametersByKey = getSpecParametersByKey(
    spec,
    specOp,
    getSpecPathParameters(spec, op),
  );

  const modelImports: string[] = [];

  for (const parameter of op.parameters) {
    if (parameter.export === 'reference') {
      modelImports.push(parameter.type);
    }

    const specParameter =
      specParametersByKey[
        specParameterKey({ in: parameter.in, name: parameter.prop })
      ];
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
      if (parameter.in === 'query' && specParameter.allowReserved) {
        parameter.allowReserved = true;
      }
    } else if (parameter.in === 'path' && specParameter) {
      const style = specParameter.style;
      if (style === 'matrix' || style === 'label') {
        parameter.pathStyle = style;
        parameter.pathExplode = !!specParameter.explode;
      }
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
  // `deepObject` serialises an object as `key[prop]=value` pairs regardless of
  // explode; the object shape (not array collection) drives its serialisation.
  if (style === 'deepObject') {
    return 'deepObject';
  }
  return explode
    ? 'multi'
    : ((
        {
          spaceDelimited: 'ssv',
          pipeDelimited: 'pipes',
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

  // The body parameter was already renamed to "body" by augmentBodyParameter.
  op.explicitRequestBodyParameter = parametersByPosition['body']?.[0];

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

  // Resolve the discriminator's language property names for marshalling.
  if (model.discriminator) {
    model.discriminator.typescriptPropertyName = toTypeScriptName(
      model.discriminator.propertyName,
    );
    model.discriminator.pythonPropertyName = toPythonName(
      'property',
      model.discriminator.propertyName,
    );
  }
};

/**
 * Ensure no two properties/parameters of an object model collapse onto the same
 * TypeScript identifier (e.g. `foo-bar` and `foo_bar` both camelCase to
 * `fooBar`, or a query and header parameter sharing a name within one request
 * position). Such a clash would emit a type with duplicate members that does
 * not compile, so fail fast with an actionable error instead.
 */
const assertNoClashingPropertyNames = (model: Model): void => {
  const seen = new Map<string, string>();
  for (const property of model.properties) {
    // Composite members are unnamed (their names are empty); skip them.
    if (!property.name) continue;
    const existing = seen.get(property.typescriptName!);
    if (existing !== undefined && existing !== property.name) {
      throw new Error(
        `Property name conflict in "${model.name}": "${existing}" and "${property.name}" both map to the TypeScript name "${property.typescriptName}". Please rename one of these in your OpenAPI specification.`,
      );
    }
    seen.set(property.typescriptName!, property.name);
  }
};

/**
 * The marshalling semantics of a property — two properties with the same key
 * convert identically on the wire (so either branch's conversion is safe).
 */
const marshallingKey = (m: Model): string => {
  if (['date', 'date-time'].includes(m.format ?? '')) return 'date';
  if (m.type === 'binary') return 'binary';
  // Enums serialise as their bare primitive (no conversion).
  if (m.isEnum || m.export === 'enum') return 'plain';
  if (COLLECTION_TYPES.has(m.export)) {
    return `${m.export}<${m.link ? marshallingKey(m.link) : 'plain'}>`;
  }
  if (m.export === 'tuple') {
    return `tuple<${m.properties.map(marshallingKey).join(',')}>`;
  }
  if (m.export === 'reference' && !PRIMITIVE_TYPES.has(m.type)) {
    return `ref:${m.type}`;
  }
  return 'plain';
};

/**
 * A non-discriminated `oneOf`/`anyOf` of object members marshals by composing
 * every member, taking only the properties present on the value. That is sound
 * exactly when no wire property is claimed by two members with different
 * marshalling (e.g. a `date-time` in one and a plain string in another) —
 * otherwise the branch cannot be determined without guessing, so fail fast and
 * ask for a discriminator rather than corrupt data at runtime.
 */
const assertNoConflictingUnionMemberMarshalling = (model: Model): void => {
  if (
    (model.export !== 'one-of' && model.export !== 'any-of') ||
    model.discriminator
  ) {
    return;
  }
  const seen = new Map<string, { memberName: string; key: string }>();
  for (const member of model.composedModels ?? []) {
    for (const property of member.properties) {
      if (!property.name) continue;
      const key = marshallingKey(property);
      const existing = seen.get(property.name);
      if (existing && existing.key !== key) {
        throw new Error(
          `Schema "${model.name}" is a non-discriminated ${camelCase(model.export)} of "${existing.memberName}" and "${member.name}", which both declare a property "${property.name}" with different types, so the correct conversion cannot be determined. Add a discriminator to the union in your OpenAPI specification (e.g. with Pydantic, Field(discriminator=...)).`,
        );
      }
      if (!existing) {
        seen.set(property.name, { memberName: member.name, key });
      }
    }
  }
};

/**
 * An `application/x-www-form-urlencoded` body is form-encoded as `key=value`
 * pairs, so the wire form is only defined for a schema with named properties
 * (an object) or a primitive sent verbatim. A top-level array or tuple has no
 * property names to key on — encoding it would emit index keys (`0=a&1=b`) that
 * no form parser can decode — so fail fast rather than generate a client that
 * is silently wrong on the wire.
 */
const assertEncodableUrlEncodedBody = (op: Operation): void => {
  const body = op.parametersBody;
  if (!body?.mediaTypes) return;
  const mediaTypes = Array.isArray(body.mediaTypes)
    ? body.mediaTypes
    : [body.mediaTypes];
  // Match the wire media type the client actually sends: JSON is preferred, so
  // an array body offering both JSON and urlencoded is sent as JSON and is fine.
  const chosenMediaType =
    mediaTypes.find(
      (mt) => mt === 'application/json' || mt.endsWith('+json'),
    ) ?? mediaTypes[0];
  if (chosenMediaType !== 'application/x-www-form-urlencoded') return;
  if (body.isPrimitive) return;
  if (body.export === 'array' || body.export === 'tuple') {
    throw new Error(
      `Operation ${op.method} ${op.path} has an application/x-www-form-urlencoded request body whose schema is a ${body.export}, which has no defined form encoding. Use an object schema (its properties become the form fields) or a primitive schema (sent verbatim) in your OpenAPI specification.`,
    );
  }
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
 * Resolve a schema to its model: an existing named model for a `$ref`, or a
 * freshly built-and-augmented model for an inline (nested value) schema.
 */
const buildOrReferenceModel = (
  spec: Spec,
  modelsByName: ModelsByName,
  schema: OpenApiSchemaOrRef,
): Model => {
  if (isRef(schema)) {
    const name = splitRef(schema.$ref)[2];
    return modelsByName[name];
  }
  const model = buildInlineModel(spec, schema);
  linkModel(spec, modelsByName, model, schema);
  augmentModelFromSchema(spec, model, schema, modelsByName);
  return model;
};

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

  // Tuple element types (3.1 `prefixItems`), positionally.
  if (model.export === 'tuple' && 'prefixItems' in schema) {
    const memberSchemas =
      (schema as { prefixItems?: OpenApiSchemaOrRef[] }).prefixItems ?? [];
    model.properties.forEach((member, i) => {
      const subSchema = resolveIfRef(spec, memberSchemas[i]);
      if (subSchema && !visited.has(member)) {
        recurse(member, subSchema);
      }
    });
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
  // method returns AsyncIterableIterator<itemSchemaModel>. Named (hoisted)
  // item schemas become references; inline primitives keep their own type.
  const jsonlResponse = op.responses.find((res) => res.isJsonlStreaming);
  if (jsonlResponse) {
    const itemSchemaModel = jsonlResponse.itemSchemaModel;
    const result = op.result;
    if (result && itemSchemaModel) {
      if (itemSchemaModel.name) {
        result.type = itemSchemaModel.name;
        result.typescriptType = itemSchemaModel.name;
        result.export = 'reference';
      } else {
        result.type = itemSchemaModel.type;
        result.typescriptType = itemSchemaModel.typescriptType;
        result.export = itemSchemaModel.export;
        result.format = itemSchemaModel.format;
        result.link = itemSchemaModel.link;
        result.isPrimitive = itemSchemaModel.isPrimitive;
      }
    }
  }

  // Add infinite query details if applicable
  if (!isMutation) {
    augmentInfiniteQuery(op);
  }
};
