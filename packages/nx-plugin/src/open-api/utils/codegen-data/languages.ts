/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import snakeCase from 'lodash.snakecase';
import { PRIMITIVE_TYPES, flattenModelLink, Model } from './types';

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

/**
 * Return the typescript type for the given model
 */
export const toTypeScriptType = (property: Model): string => {
  const propertyLink = flattenModelLink(property.link);
  switch (property.export) {
    case 'generic':
    case 'reference':
      return toTypescriptPrimitive(property);
    case 'array':
      return `Array<${propertyLink && propertyLink.export !== 'enum' ? toTypeScriptType(propertyLink) : property.type}>`;
    case 'dictionary':
      return `{ [key: string]: ${propertyLink && propertyLink.export !== 'enum' ? toTypeScriptType(propertyLink) : property.type}; }`;
    case 'one-of':
    case 'any-of':
    case 'all-of':
      return property.name;
    default:
      return property.type;
  }
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
    if ((property as any).openapiType === 'integer') {
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

/**
 * Return the python type for a given property
 */
export const toPythonType = (property: Model): string => {
  const propertyLink = flattenModelLink(property.link);
  switch (property.export) {
    case 'generic':
    case 'reference':
      return toPythonPrimitive(property);
    case 'array':
      return `List[${propertyLink && propertyLink.export !== 'enum' ? toPythonType(propertyLink) : property.type}]`;
    case 'dictionary':
      return `Dict[str, ${propertyLink && propertyLink.export !== 'enum' ? toPythonType(propertyLink) : property.type}]`;
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

  // Check if the name is a reserved word. Reserved words that overlap with TypeScript will already be escaped
  // with a leading _ by @hey-api/openapi-ts, so we remove this to test
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
