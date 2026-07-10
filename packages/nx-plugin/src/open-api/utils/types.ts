/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { OpenAPIV3, OpenAPIV3_1 } from 'openapi-types';

export type Spec = OpenAPIV3.Document | OpenAPIV3_1.Document;

/**
 * An OpenAPI schema object, spanning the 3.0 and 3.1 shapes plus the additional
 * JSON-Schema / 3.1 keywords the code generator inspects that are absent from
 * the `openapi-types` 3.0 definition (`patternProperties`, `const`, and the 3.0
 * `nullable` flag), and the 3.1 `contentMediaType`/`contentEncoding` keywords
 * used to detect binary string fields.
 */
export type OpenApiSchema = (
  | OpenAPIV3.SchemaObject
  | OpenAPIV3_1.SchemaObject
) & {
  nullable?: boolean;
  const?: unknown;
  contentMediaType?: string;
  contentEncoding?: string;
  patternProperties?: {
    [pattern: string]: OpenApiSchemaOrRef;
  };
  discriminator?: OpenAPIV3.DiscriminatorObject;
};

export type OpenApiSchemaOrRef = OpenApiSchema | OpenAPIV3.ReferenceObject;
