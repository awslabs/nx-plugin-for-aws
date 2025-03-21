/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Plugin } from '@hey-api/openapi-ts';
import type { OpenAPIV3, OpenAPIV3_1 } from 'openapi-types';

export type ClientData = Parameters<Plugin.LegacyHandler<any>>[0]['client'];
export type Operation = ClientData['services'][number]['operations'][number];
export type Model = ClientData['models'][number];

export interface CodeGenData extends ClientData {
  className: string;
  info: OpenAPIV3.InfoObject | OpenAPIV3_1.InfoObject;
  allOperations: Operation[];
  operationsByTag: { [tag: string]: Operation[] };
  untaggedOperations: Operation[];
  vendorExtensions: { [key: string]: any };
}

export const flattenModelLink = (link?: Model | Model[]): Model =>
  link === undefined ? undefined : Array.isArray(link) ? link[0] : link;

// Model types which indicate it is composed (ie inherits/mixin's another schema)
export const COMPOSED_SCHEMA_TYPES = new Set(['one-of', 'any-of', 'all-of']);
export const COLLECTION_TYPES = new Set(['array', 'dictionary']);
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
