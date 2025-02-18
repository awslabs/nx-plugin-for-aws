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
  info: OpenAPIV3.InfoObject | OpenAPIV3_1.InfoObject;
  allOperations: Operation[];
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
