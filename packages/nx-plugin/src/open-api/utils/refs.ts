/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { OpenAPIV3 } from 'openapi-types';
import { Spec } from './types';

/**
 * Return whether or not the given OpenAPI object is a reference
 */
export const isRef = (obj: unknown): obj is OpenAPIV3.ReferenceObject =>
  !!obj && typeof obj === 'object' && '$ref' in obj;

/**
 * Split a reference into its component parts
 * eg: #/components/schemas/Foo -> ["components", "schemas", "Foo"]
 */
export const splitRef = (ref: string): string[] =>
  ref
    .slice(2)
    .split('/')
    .map((p) => p.replace(/~0/g, '~').replace(/~1/g, '/'));

/**
 * Resolve the given reference in the spec
 */
export const resolveRef = (spec: Spec, ref: string): any => {
  const refParts = splitRef(ref);
  const resolved = refParts.reduce(
    (resolvedInSpec, refPart) => resolvedInSpec?.[refPart],
    spec,
  );
  if (!resolved) {
    throw new Error(`Unable to resolve ref ${ref} in spec`);
  }
  return resolved;
};

/**
 * Resolve the given object in an openapi spec if it's a ref
 */
export const resolveIfRef = <T>(
  spec: Spec,
  possibleRef: T | OpenAPIV3.ReferenceObject,
): T => {
  let resolved = possibleRef;
  if (isRef(possibleRef)) {
    resolved = resolveRef(spec, possibleRef.$ref);
  }
  return resolved as T;
};
