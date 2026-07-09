/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { camelCase, snakeCase, toClassName } from '../../../utils/names';
import { type Model, PRIMITIVE_TYPES } from './types';

const toTypescriptPrimitive = (property: Model): string => {
  if (
    property.type === 'string' &&
    ['date', 'date-time'].includes(property.format ?? '')
  ) {
    return 'Date';
  } else if (property.type === 'binary') {
    return 'Blob';
  }
  return property.type;
};

export const toTypeScriptType = (property: Model): string => {
  // A discriminated subtype's discriminator property renders as its literal
  // tag, making the union a true (narrowable) tagged union.
  if (property.discriminatorValue) {
    return property.discriminatorValue;
  }
  const link = property.link;
  // Enum links serialise as their primitive; use the model's own type instead.
  const valueType = () =>
    link && link.export !== 'enum' ? toTypeScriptType(link) : property.type;
  switch (property.export) {
    case 'enum':
    case 'generic':
      return toTypescriptPrimitive(property);
    case 'array':
      return `Array<${valueType()}>`;
    case 'dictionary':
      return `{ [key: string]: ${valueType()}; }`;
    case 'one-of':
    case 'any-of':
    case 'all-of':
      return toTypeScriptModelName(property.name);
    case 'reference':
    default:
      if (property.type === 'unknown') {
        return 'unknown';
      }
      if (PRIMITIVE_TYPES.has(property.type)) {
        return toTypescriptPrimitive(property);
      }
      return toTypeScriptModelName(property.type);
  }
};

export const toTypeScriptName = (name: string): string => {
  // A name of only non-identifier characters (e.g. "_") camelCases to an empty
  // string; fall back to an underscore so the emitted property stays valid.
  return camelCase(name) || (name ?? '').replace(/[^a-zA-Z0-9]/g, '_') || '_';
};

const TYPESCRIPT_RESERVED_MODEL_NAMES = new Set([
  'Date',
  'Blob',
  'Object',
  'String',
  'Boolean',
  'Integer',
  'Long',
  'Float',
  'Array',
  'ReadonlyArray',
  'File',
  'Error',
  'Map',
  'Set',
  'Number',
  'Symbol',
  'BigInt',
  'Function',
  'Promise',
  'RegExp',
  'JSON',
]);

export const toTypeScriptModelName = (name: string): string => {
  const candidateName = toClassName(name);

  // Prepend underscore for any reserved model names
  return TYPESCRIPT_RESERVED_MODEL_NAMES.has(candidateName)
    ? `_${candidateName}`
    : candidateName;
};

const toPythonPrimitive = (property: Model): string => {
  if (property.type === 'string' && property.format === 'date') {
    return 'date';
  } else if (property.type === 'string' && property.format === 'date-time') {
    return 'datetime';
  } else if (property.type === 'any') {
    return 'object';
  } else if (property.type === 'binary') {
    return 'bytearray';
  } else if (property.type === 'number') {
    if (property.openapiType === 'integer') {
      return 'int';
    }

    switch (property.format) {
      case 'int32':
      case 'int64':
        return 'int';
      case 'float':
      case 'double':
      default:
        return 'float';
    }
  } else if (property.type === 'boolean') {
    return 'bool';
  } else if (property.type === 'string') {
    return 'str';
  }
  return property.type;
};

export const toPythonType = (property: Model): string => {
  const link = property.link;
  const valueType = () =>
    link && link.export !== 'enum' ? toPythonType(link) : property.type;
  switch (property.export) {
    case 'generic':
    case 'reference':
      return toPythonPrimitive(property);
    case 'array':
      return `List[${valueType()}]`;
    case 'dictionary':
      return `Dict[str, ${valueType()}]`;
    case 'one-of':
    case 'any-of':
    case 'all-of':
      return property.name;
    default:
      // "any" has export = interface
      if (PRIMITIVE_TYPES.has(property.type)) {
        return toPythonPrimitive(property);
      }
      return property.type;
  }
};

// @see https://github.com/OpenAPITools/openapi-generator/blob/e2a62ace74de361bef6338b7fa37da8577242aef/modules/openapi-generator/src/main/java/org/openapitools/codegen/languages/AbstractPythonCodegen.java#L106
const PYTHON_KEYWORDS = new Set([
  // @property
  'property',
  // typing keywords
  'schema',
  'base64',
  'json',
  'date',
  'float',
  // python reserved words
  'and',
  'del',
  'from',
  'not',
  'while',
  'as',
  'elif',
  'global',
  'or',
  'with',
  'assert',
  'else',
  'if',
  'pass',
  'yield',
  'break',
  'except',
  'import',
  'print',
  'class',
  'exec',
  'in',
  'raise',
  'continue',
  'finally',
  'is',
  'return',
  'def',
  'for',
  'lambda',
  'try',
  'self',
  'nonlocal',
  'None',
  'True',
  'False',
  'async',
  'await',
]);

export const toPythonName = (
  namedEntity: 'model' | 'property' | 'operation',
  name: string,
) => {
  const nameSnakeCase = snakeCase(name);

  // Names overlapping a TypeScript reserved word carry a leading `_`; strip it
  // before testing against the Python keyword set.
  if (PYTHON_KEYWORDS.has(name.startsWith('_') ? name.slice(1) : name)) {
    const nameSuffix = `_${nameSnakeCase}`;
    switch (namedEntity) {
      case 'model':
        return `model${nameSuffix}`;
      case 'operation':
        return `call${nameSuffix}`;
      case 'property':
        return `var${nameSuffix}`;
      default:
        break;
    }
  }
  return nameSnakeCase;
};
